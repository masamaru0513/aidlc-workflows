// covers: file:core/memory/org.md function:augmentDispatchRules
//
// t263-conversation-language — the CONVERSATION-LANGUAGE rule layer
// (deterministic, no-LLM, no-network). Pins the four `## Mandated` rules in
// `org.md` that make human-readable artifacts follow the conversation language
// instead of defaulting to English (#288).
//
// The rules are prose, so what CAN be pinned deterministically is the machinery
// around them: that they ship to every harness, that they stay quotable by the
// claim-sources sensor, that a delegated agent actually receives them, and that
// the English exception never regresses back to whole-file scope. Those are the
// three regression areas the review asked for — language continuity, delegated
// execution, and preservation of machine tokens.
//
// Four contracts land here:
//   (a) SHIP PARITY: all four rules live under `## Mandated` in the authored
//       `core/memory/org.md` AND byte-identically in both org.md projections of
//       every shipped harness (the engine-bundled `tools/data/memory-seed/` seed
//       and the `aidlc/spaces/default/memory/` workspace shell). A harness that
//       silently drops the rule layer would leave its users on English output.
//   (b) LINE-LEVEL QUOTABILITY: each rule is ONE physical line. The
//       claim-sources sensor resolves a `[memory:M<n>]` source by stripping the
//       bullet marker from each line under the named H2 and requiring the quoted
//       rule to match an entry EXACTLY. A rule wrapped across lines can never be
//       registered as a source, so a stage that reasons from it would fail its
//       own sensor. This is the constraint that forces the one-line-per-rule
//       shape — it is easy to "improve" readability and break it.
//   (c) DELEGATED EXECUTION: a subagent never sees the conversation, so the
//       rules must arrive in its brief. The dispatch-rules PreToolUse hook is
//       that carrier; augmentDispatchRules must rewrite a delegated prompt to
//       carry all four rules verbatim.
//   (d) TOKEN SCOPE: the preserved-token rule names the real protocol tokens,
//       and the rule set does NOT reintroduce a blanket whole-file English
//       exception (the pre-review shape said "any other tool-read file", which
//       wrongly Englished Markdown artifacts that only mix in parsed islands).
//
// MECHANISM. (a)/(b)/(d) read the shipped files directly (the `none` floor).
// (c) SPAWNS the real engine CLI to birth an intent into a temp project, then
// calls the shipped hook's exported pure entry in-process. Zero tokens, zero
// network.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../harness/fixtures.ts";
import { HARNESS_MATRIX } from "../harness/harness-matrix.ts";
import { augmentDispatchRules } from "../../dist/claude/.claude/hooks/aidlc-dispatch-rules.ts";

const BUN = process.execPath;
const UTILITY = join(REPO_ROOT, "dist", "claude", ".claude", "tools", "aidlc-utility.ts");
const AUTHORED_ORG_MD = join(REPO_ROOT, "core", "memory", "org.md");

/** The four rules' stable lead-ins. Deliberately the bold label only: the bodies
 *  are prose a maintainer may reword, but a MISSING or RENAMED rule is a
 *  regression these tests must catch. */
const RULE_LABELS = [
  "**Conversation language — resolution**",
  "**Conversation language — stability**",
  "**Conversation language — what to localize**",
  "**Conversation language — preserved tokens**",
] as const;

/** Protocol tokens the preserved-token rule must keep naming. Each one is a real
 *  parsed island or exact-compared literal in the shipped engine — dropping it
 *  from the rule invites an agent to localize something a tool matches verbatim.
 *  All of these were found by grepping the shipped engine during an end-to-end
 *  Japanese run, and several are exact `===`/`!==` comparisons rather than
 *  advisory shapes:
 *    - `A. Accept assumptions` — aidlc-sensor-claim-sources.ts compares the
 *      filled `[Answer]:` against this literal to set assumptionsAccepted.
 *    - `**Collaborator:** <agent-slug>` — compared with `!==` against a
 *      contribution file's first line in aidlc-orchestrate.ts, aidlc-state.ts,
 *      and aidlc-doctor-bundle.ts; a localized marker fails the stage outright.
 *    - `None.` / `None` — sentinels the conductor branches on under
 *      `## Assumptions & Open Questions` and `## Positions`.
 *    - `X. Other (please specify)` — the mandatory final option of every
 *      question (stage-protocol §3, "no exceptions").
 *  The rule also states the GENERAL principle (a backticked literal a stage
 *  file tells you to write exactly is a fixed token), so this list pins the
 *  high-risk instances rather than trying to be exhaustive. */
const REQUIRED_TOKENS = [
  "[Answer]:",
  "X. Other (please specify)",
  "A. Accept assumptions",
  "B. Convert to follow-up questions",
  "`None.` / `None`",
  "AGREE:",
  "OBJECT:",
  "**Collaborator:** <agent-slug>",
  "[desc]",
  "[scope]",
  "[assumption]",
  "[Q<n>]",
  "[memory:M<n>]",
  "required-sections",
  "## Sources",
  "## Assumptions & Open Questions",
  "## Assumption Confirmation",
  "## Review",
  "READY",
  "NOT-READY",
  "depends_on",
  "aidlc-state.md",
] as const;

/** The no-signal turn shapes the review named. A turn that is only one of these
 *  must never flip the conversation language — this is review requirement 1's
 *  concrete test. */
const NO_SIGNAL_TURNS = [
  "`Approve`",
  "`Looks correct`",
  "an option letter or number",
  "pasted code",
  "a quoted error or stack trace",
  "a bare file path or identifier",
] as const;

/** The over-broad phrasings the review rejected. Any of these coming back means
 *  the English exception has widened from "parsed syntax" to "whole file". */
const FORBIDDEN_BLANKETS = [
  "any other tool-read file",
  "machine-parsed state files",
  "Machine-facing files stay fully English",
] as const;

/** Visible lines under an H2, reduced the way aidlc-sensor-claim-sources.ts
 *  reduces them when resolving a `[memory:M<n>]` source: bullet marker stripped,
 *  trimmed, blanks and blockquotes dropped. Mirroring the sensor here is the
 *  point — it is what makes (b) a real contract and not a formatting opinion. */
function sectionEntries(body: string, heading: string): string[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end))
    .map((line) => line.replace(/^ {0,3}(?:[-*+]|\d+\.)\s+/, "").trim())
    .filter((line) => line.length > 0 && !/^>/.test(line) && !/^<!--/.test(line));
}

/** Both org.md projections of a shipped harness: the engine-bundled seed used by
 *  the engine-only-install self-heal, and the workspace shell users copy. */
function orgMdProjections(): Array<{ label: string; path: string }> {
  const out: Array<{ label: string; path: string }> = [];
  for (const harness of HARNESS_MATRIX) {
    out.push({
      label: `${harness.name} memory-seed`,
      path: join(harness.engineRoot, "tools", "data", "memory-seed", "org.md"),
    });
    out.push({
      label: `${harness.name} workspace shell`,
      path: join(harness.distRoot, "aidlc", "spaces", "default", "memory", "org.md"),
    });
  }
  return out;
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("t263 conversation-language rule layer", () => {
  // === (a) SHIP PARITY =====================================================
  test("a: all four rules sit under ## Mandated in the authored source", () => {
    const entries = sectionEntries(readFileSync(AUTHORED_ORG_MD, "utf-8"), "Mandated");
    for (const label of RULE_LABELS) {
      expect(
        entries.some((entry) => entry.startsWith(label)),
        `${label} is a ## Mandated entry in core/memory/org.md`,
      ).toBe(true);
    }
  });

  test("a: every shipped harness carries the authored org.md byte-for-byte", () => {
    const authored = readFileSync(AUTHORED_ORG_MD, "utf-8");
    const projections = orgMdProjections();
    // Guards against a harness manifest that stops projecting the method tree:
    // five shipped harnesses x two projections.
    expect(projections.length).toBe(HARNESS_MATRIX.length * 2);
    for (const { label, path } of projections) {
      expect(readFileSync(path, "utf-8"), `${label} matches core/memory/org.md`).toBe(authored);
    }
  });

  // === (b) LINE-LEVEL QUOTABILITY ==========================================
  test("b: each rule is one physical line, so the claim-sources sensor can quote it", () => {
    const body = readFileSync(AUTHORED_ORG_MD, "utf-8").replace(/\r\n/g, "\n");
    const lines = body.split("\n");
    const entries = sectionEntries(body, "Mandated");
    for (const label of RULE_LABELS) {
      const matches = entries.filter((entry) => entry.startsWith(label));
      // Exactly one entry per rule: a wrapped rule would surface as a leading
      // entry plus orphan continuation entries, and the sensor's exact-match
      // lookup would never resolve the full sentence.
      expect(matches.length, `${label} resolves to exactly one sensor entry`).toBe(1);

      const at = lines.findIndex((line) => line.includes(label));
      expect(at, `${label} appears on exactly one raw line`).toBeGreaterThan(-1);
      expect(lines.filter((line) => line.includes(label)).length).toBe(1);
      // The raw line IS the whole entry (no leading indent, bullet at column 0).
      expect(lines[at]).toBe(`- ${matches[0]}`);
      // And nothing continues it. A soft-wrapped rule leaves an INDENTED prose
      // line beneath the bullet; Markdown folds that into the same list item,
      // but the sensor reduces line-by-line and would only ever see the first
      // line — so the quoted source could never match. The next line must
      // therefore be blank, a new top-level bullet, or the next heading.
      const next = lines[at + 1] ?? "";
      expect(
        next.trim() === "" || /^(?:- |## )/.test(next),
        `${label} is not soft-wrapped (continuation line found: ${JSON.stringify(next)})`,
      ).toBe(true);
      // A complete rule reads as a finished sentence.
      expect(matches[0].endsWith("."), `${label} ends as a complete sentence`).toBe(true);
    }
  });

  // === (c) DELEGATED EXECUTION =============================================
  test("c: a delegated dispatch is rewritten to carry all four rules", () => {
    const proj = mkdtempSync(join(tmpdir(), "aidlc-t263-"));
    tempDirs.push(proj);
    const birth = spawnSync(
      BUN,
      [UTILITY, "intent-birth", "--scope", "poc", "--arguments", "x", "--project-dir", proj],
      { encoding: "utf-8" },
    );
    expect(birth.status, `intent-birth failed: ${birth.stdout}\n${birth.stderr}`).toBe(0);

    const result = augmentDispatchRules(
      "task",
      {
        subagent_type: "aidlc-product-agent",
        prompt: "Execute the current stage and write its artifacts.",
      },
      proj,
    );
    expect(result.error ?? null, "dispatch rewrite produced no error").toBeNull();
    expect(result.changed, "the hook rewrote the delegated prompt").toBe(true);

    const prompt = String(result.updatedInput?.prompt ?? "");
    for (const label of RULE_LABELS) {
      // A subagent cannot see the conversation; the bundle is how it learns the
      // language contract at all.
      expect(prompt.includes(label), `${label} reached the delegated brief`).toBe(true);
    }
  });

  // === (c2) HARNESS DELIVERY ===============================================
  // (c) proves the hook rewrite path. Claude, Codex, and opencode use it, but
  // Kiro CLI has no input-rewrite channel and Kiro IDE cannot expose tool
  // arguments at all — both rely on PRELOAD instead. Without this contract a
  // Kiro manifest could stop projecting the memory glob and the rules would
  // silently stop reaching delegated agents on that harness, with (c) still
  // green.
  test("c2: every harness ships a surface that delivers active memory to delegated agents", () => {
    for (const harness of HARNESS_MATRIX) {
      const hook = join(harness.engineRoot, "hooks", "aidlc-dispatch-rules.ts");
      expect(existsSync(hook), `${harness.name} ships the dispatch-rules hook`).toBe(true);

      if (!harness.capabilities.kiroAgentJson) continue;
      // Kiro's preload path: EVERY agent config must name the active-space
      // memory glob, or that agent starts a stage without the rule layer.
      const agentsDir = join(harness.engineRoot, "agents");
      const configs = readdirSync(agentsDir).filter((f) => f.endsWith(".json"));
      expect(configs.length, `${harness.name} ships agent configs`).toBeGreaterThan(0);
      for (const file of configs) {
        const raw: unknown = JSON.parse(readFileSync(join(agentsDir, file), "utf-8"));
        const resources = (raw as { resources?: unknown }).resources;
        const list = Array.isArray(resources) ? resources.filter((r): r is string => typeof r === "string") : [];
        expect(
          list.some((r) => r.includes("memory")),
          `${harness.name}/${file} preloads the active-space memory tree`,
        ).toBe(true);
      }
    }
  });

  // === (d) TOKEN SCOPE =====================================================
  test("d: the stability rule names every no-signal turn shape (language continuity)", () => {
    // The review's first requirement: a turn that is only `Approve`, an option
    // number, pasted code, or an English error must NOT flip the language. The
    // rule can only hold the line if it enumerates those shapes, so pin them.
    const entries = sectionEntries(readFileSync(AUTHORED_ORG_MD, "utf-8"), "Mandated");
    const rule = entries.find((entry) =>
      entry.startsWith("**Conversation language — stability**"),
    );
    expect(rule, "the stability rule exists").toBeDefined();
    for (const shape of NO_SIGNAL_TURNS) {
      expect(rule?.includes(shape), `stability rule names the no-signal turn "${shape}"`).toBe(true);
    }
    // And it must keep the two-step distinction that makes a switch usable:
    // the change is live at once; persistence is durability, not activation.
    expect(rule?.includes("IMMEDIATELY"), "stability rule makes a switch take effect at once").toBe(true);
    expect(
      rule?.includes("never the activation step"),
      "stability rule separates persistence from activation",
    ).toBe(true);
  });

  test("d: the resolution rule gives a delegated agent a source that always exists", () => {
    // Sources that read files can all come up empty: a greenfield run of a
    // stage whose `consumes` are every one `conditional_on: brownfield`
    // (practices-discovery) reaches its dispatched LEAD with no upstream
    // artifact and no draft. The orchestrator-stated brief line is the only
    // source that cannot be empty, so the rule must mandate it.
    const entries = sectionEntries(readFileSync(AUTHORED_ORG_MD, "utf-8"), "Mandated");
    const rule = entries.find((entry) =>
      entry.startsWith("**Conversation language — resolution**"),
    );
    expect(rule, "the resolution rule exists").toBeDefined();
    expect(
      rule?.includes("MUST state it as a `Conversation language: <language>` line in every delegated brief"),
      "resolution rule obliges the orchestrator to state the language in every brief",
    ).toBe(true);
    // Reviewers judge a `produces[]` artifact and spokes are dispatched against
    // a lead DRAFT; naming only `consumes[]` would exclude both.
    for (const handed of [
      "`consumes[]` contracts",
      "the artifact you were dispatched to review",
      "the lead draft you were dispatched against",
    ]) {
      expect(rule?.includes(handed), `resolution rule covers ${handed}`).toBe(true);
    }
  });

  test("d: the preserved-token rule names every protocol token it must protect", () => {
    const entries = sectionEntries(readFileSync(AUTHORED_ORG_MD, "utf-8"), "Mandated");
    const rule = entries.find((entry) =>
      entry.startsWith("**Conversation language — preserved tokens**"),
    );
    expect(rule, "the preserved-tokens rule exists").toBeDefined();
    for (const token of REQUIRED_TOKENS) {
      expect(rule?.includes(token), `preserved-tokens rule names ${token}`).toBe(true);
    }
  });

  test("d: the English exception never widens back to whole files", () => {
    // Checked across every projection, not just the authored source: a stale
    // dist would ship the rejected shape to users.
    const bodies = [
      { label: "core/memory/org.md", text: readFileSync(AUTHORED_ORG_MD, "utf-8") },
      ...orgMdProjections().map(({ label, path }) => ({
        label,
        text: readFileSync(path, "utf-8"),
      })),
    ];
    for (const { label, text } of bodies) {
      for (const blanket of FORBIDDEN_BLANKETS) {
        expect(
          text.includes(blanket),
          `${label} must not reintroduce the whole-file English exception "${blanket}"`,
        ).toBe(false);
      }
    }
  });

  // === (e) SWITCH PRECEDENCE ================================================
  // The second-pass review found the ordering contradiction these two tests
  // pin. The resolution rule used to rank a persisted `project.md`/`team.md`
  // language rule ABOVE the brief line, while the stability rule promised an
  // explicit switch takes effect immediately and persists only later at the
  // human-gated learnings ritual. A persisted-Japanese workflow that switched
  // to English therefore sent `Conversation language: English` in the brief and
  // the delegate stopped at the stale memory rule first.
  //
  // The fix inverts the two: the brief is authoritative for delegated work
  // because the orchestrator regenerates it from the live conversation on every
  // dispatch, so it can never be staler than a file on disk. Memory is the
  // fallback for a brief that states no language.
  test("e: the brief outranks persisted memory in the resolution order", () => {
    const entries = sectionEntries(readFileSync(AUTHORED_ORG_MD, "utf-8"), "Mandated");
    const rule = entries.find((entry) =>
      entry.startsWith("**Conversation language — resolution**"),
    );
    expect(rule, "the resolution rule exists").toBeDefined();

    const briefFirst = rule!.indexOf("(1) the `Conversation language:` line in your brief");
    const memorySecond = rule!.indexOf("(2) an explicit conversation-language rule");
    expect(briefFirst, "the brief line is ranked (1)").toBeGreaterThan(-1);
    expect(memorySecond, "the persisted memory rule is ranked (2)").toBeGreaterThan(-1);
    expect(briefFirst, "the brief is resolved BEFORE persisted memory").toBeLessThan(
      memorySecond,
    );
    // Naming the roles is what makes the ordering survive a reword.
    expect(rule!.includes("AUTHORITATIVE for delegated work")).toBe(true);
    expect(rule!.includes("the FALLBACK for a brief that states no language")).toBe(true);

    // The learnings write path APPENDS (aidlc-learnings.ts appendUnderHeading,
    // deduped only against an identical line), and org.md's `## Corrections`
    // ships empty so the ritual's admission conflict-check has nothing to
    // compare against. Both language rules can therefore sit on disk at once,
    // which leaves the fallback ambiguous unless the rule breaks the tie.
    expect(
      rule!.includes("the LAST one under `## Corrections` is the current one"),
      "the fallback breaks the append-only tie deterministically",
    ).toBe(true);
    expect(
      rule!.includes("governs conversation-language rules ONLY"),
      "the tie-break is scoped and does not override the additive rule model",
    ).toBe(true);

    // The orchestrator resolves from the conversation, not from the precedence
    // list (which addresses delegated agents and reviewers). Without this the
    // brief's authority has no source: a stale project.md could still win at
    // the point the brief is WRITTEN.
    const stability = entries.find((entry) =>
      entry.startsWith("**Conversation language — stability**"),
    );
    expect(stability, "the stability rule exists").toBeDefined();
    expect(
      stability!.includes(
        "A persisted rule NEVER outranks the brief, and never outranks a later explicit human request to switch",
      ),
      "the stability rule binds the orchestrator as well as the delegate",
    ).toBe(true);
    expect(
      stability!.includes("outranks every other source"),
      "the superseded persisted-rule-wins clause is gone",
    ).toBe(false);
  });

  test("e: a stale persisted language plus an explicit switch still delivers the tie-break", () => {
    // The review's regression case: an existing persisted language, then an
    // explicit switch, then a delegated stage. The rules are prose, so what is
    // verifiable here is the DELIVERY contract — that the delegate receives the
    // stale memory rule and the brief line and the precedence rule that decides
    // between them, in one prompt. Whether the model then writes English is
    // model-directed and out of reach of a deterministic test.
    const proj = mkdtempSync(join(tmpdir(), "aidlc-t263-switch-"));
    tempDirs.push(proj);
    const birth = spawnSync(
      BUN,
      [UTILITY, "intent-birth", "--scope", "poc", "--arguments", "x", "--project-dir", proj],
      { encoding: "utf-8" },
    );
    expect(birth.status, `intent-birth failed: ${birth.stdout}\n${birth.stderr}`).toBe(0);

    // Persist Japanese the way the learnings ritual would: a single-line rule
    // appended under `## Corrections` in the active space's project.md.
    const projectMd = join(proj, "aidlc", "spaces", "default", "memory", "project.md");
    expect(existsSync(projectMd), "the active space ships project.md").toBe(true);
    const stale = "- Conversation language: Japanese.";
    const body = readFileSync(projectMd, "utf-8");
    expect(body.includes("## Corrections"), "project.md ships ## Corrections").toBe(true);
    writeFileSync(
      projectMd,
      body.replace("## Corrections", `## Corrections\n\n${stale}`),
      "utf-8",
    );

    // The human has since asked for English, so the orchestrator states English.
    const result = augmentDispatchRules(
      "task",
      {
        subagent_type: "aidlc-product-agent",
        prompt:
          "Conversation language: English\n\nExecute the current stage and write its artifacts.",
      },
      proj,
    );
    expect(result.error ?? null, "dispatch rewrite produced no error").toBeNull();
    expect(result.changed, "the hook rewrote the delegated prompt").toBe(true);

    const prompt = String(result.updatedInput?.prompt ?? "");
    expect(prompt.includes("Conversation language: English"), "the brief line survives").toBe(
      true,
    );
    expect(prompt.includes(stale.replace(/^- /, "")), "the stale memory rule is delivered too").toBe(
      true,
    );
    expect(
      prompt.includes("AUTHORITATIVE for delegated work"),
      "the delegate also receives the rule that resolves the conflict",
    ).toBe(true);
    // The bundle is APPENDED after the brief (augmentText: prompt + bundleBlock),
    // so the stale rule sits LATER in the prompt than the brief line. That is
    // exactly why precedence has to be stated explicitly rather than implied by
    // position — pin the arrangement so a future reorder cannot quietly rely on
    // recency instead.
    expect(
      prompt.indexOf("Conversation language: English") <
        prompt.indexOf("AUTHORITATIVE for delegated work"),
      "the precedence rule is co-located with the stale rule, after the brief",
    ).toBe(true);
  });
});
