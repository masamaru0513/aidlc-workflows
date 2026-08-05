# 引き継ぎ: awslabs/aidlc-workflows PR #353 の敵対的検証と修正

作成: 2026-08-06 / 対象PR: https://github.com/awslabs/aidlc-workflows/pull/353

---

## このブランチの構成（最初に読む）

このドキュメントは `handoff/pr353-adversarial-review` ブランチに置かれている。
**PRブランチ (`fix/v2-language-convention`) は一切変更していない。**

```
handoff/pr353-adversarial-review
├── <このコミット>  docs: hand off the PR #353 adversarial review    ← .handoff/ のみ
├── c7bf3df         test: close the negative-space and delivery gaps in t263
└── 6cd704c         fix: make the §13 ritual the only write path ... ← PRブランチのHEAD
```

### 使い方

テスト修正だけをPRブランチに載せる（`.handoff/` は持ち込まない）:

```powershell
cd "C:\Users\ionn\OneDrive\ドキュメント\GitHub\OSSContribute\aidlc-workflows"
git switch fix/v2-language-convention
git cherry-pick c7bf3df
bun run check   # exit 0 を確認
git push --force-with-lease origin fix/v2-language-convention   # ★ユーザー承認を取ってから
```

`c7bf3df` の中身は `CHANGELOG.md` (+1) と `tests/unit/t263-conversation-language-rule.test.ts` (+179/-37) の2ファイルのみ。`core/` は触っていないので **dist再生成は不要**。

`.handoff/` はこのブランチだけの作業用ディレクトリ。**PRに含めないこと。**

---

## 0. 作業環境

| 項目 | 値 |
|---|---|
| クローン先 | `C:\Users\ionn\OneDrive\ドキュメント\GitHub\OSSContribute\aidlc-workflows` |
| ブランチ | `fix/v2-language-convention` (fork: `masamaru0513/aidlc-workflows`) |
| HEAD | `6cd704c` |
| upstream | `awslabs/aidlc-workflows` を remote `upstream` として追加済み。`upstream/v2` = `c73ee98` |
| リベース状態 | **最新**（`git rev-list --count HEAD..upstream/v2` = 0） |
| ランタイム | bun 1.3.13。`bun install` 済み（111 packages） |

### Windows特有の注意（重要）

パスに日本語（`ドキュメント`）が含まれるため、**Python系コマンドは `$env:PYTHONUTF8 = "1"` が必須**（cp932のUnicodeDecodeErrorになる）。bunは影響を受けない。

PowerShellで `-like '## [*'` はワイルドカードエラーになる。`-match` か文字列メソッドを使う。
複雑なPowerShell関数＋リダイレクトは出力が消えることがあったので、**検証は1コマンド1目的で分ける**こと。

### 主要コマンド

```powershell
cd "C:\Users\ionn\OneDrive\ドキュメント\GitHub\OSSContribute\aidlc-workflows"

bun run check          # package --check(5ハーネス) + typecheck(3構成) + biome(558ファイル)
bun scripts/package.ts # core/ 変更後のdist再生成（必須）
bun test tests/unit/t263-conversation-language-rule.test.ts
```

`core/memory/org.md` を編集したら**必ず `bun scripts/package.ts` で dist を再生成**する。10個のprojection（5ハーネス × memory-seed/workspace-shell）がバイト一致を要求される。

---

## 1. PRの中身

`core/memory/org.md` の `## Mandated` に会話言語ルール4本を追加する変更。1つのharness-neutralソースが `bun scripts/package.ts` 経由で5ハーネス（claude, codex, kiro, kiro-ide, opencode）に伝播する。Fixes #288。

ルール4本（すべて**1物理行**、2087 / 1645 / 691 / 2002文字）:

1. `**Conversation language — resolution**` — 解決順序 (1)briefのAUTHORITATIVE → (2)project/team.mdのFALLBACK → (3)`**Project**` → (4)handed artifact
2. `**Conversation language — stability**` — no-signalターン列挙、即時切替、§13 ritualが唯一の書き込み経路
3. `**Conversation language — what to localize**` — ローカライズ対象
4. `**Conversation language — preserved tokens**` — 英語固定トークン

差分: 21ファイル +604/-29（`core/memory/org.md`、dist 10ファイル、version 6ファイル、README badge、CHANGELOG、テスト新規、ratchet登録）。

### レビュー状況

- **apackeer**: request changes（4点）→ 対応済み → 再レビュー待ち
- **leandrodamascena**: approve 済み
- apackeer 第2ラウンド指摘（persisted Japanese + explicit switch + delegated stage）→ `407abe8` / `6cd704c` で対応

---

## 2. 敵対的検証で確認できたこと（主張は正確）

エンジン側の事実主張はすべてソースで裏取り済み。**誇張なし**。

| 主張 | 実物（検証済み） |
|---|---|
| `A. Accept assumptions` を完全一致比較 | `core/tools/aidlc-sensor-claim-sources.ts:44` に定数、`:504-505` で `===` |
| localizeすると **silent failure** | `:851` の `else if (universe.assumptionsAccepted && ...)` が丸ごとスキップ。findingが出ない |
| `**Collaborator:**` を `!==` で比較 | `aidlc-orchestrate.ts:3821` / `aidlc-state.ts:2813` / `aidlc-doctor-bundle.ts:835` |
| `None.`/`None` センチネル | `isNoneBlock = /^None\.?$/i` (`:524-525`) |
| `X. Other (please specify)` | `core/aidlc-common/protocols/stage-protocol.md:242` に "no exceptions" 付き |
| 1物理行が必須の理由 | `entries.includes(rule)` (`:343`) が行単位reduce後に完全一致を要求 |
| frameworkはtemplate同梱せず | `core/tools/data/templates/` は `.gitkeep` のみ |
| hookが全ハーネスで同一 | `core/hooks/aidlc-dispatch-rules.ts` と5ハーネスのSHA256が一致 (`997D19FB...`) |
| Kiroのmemory glob | 15個のagent json（kiro/kiro-ide各15）すべてが `file://aidlc/spaces/default/memory/**/*.md` |

apackeerの4指摘はすべて実体として解消済み（version bump 2.5.37→2.5.38、README badge、CHANGELOG の Upgrade注記、ratchet登録も確認済み）。

---

## 3. 見つけた問題と対応状況

### 完了（未コミット、作業ツリーに存在）

| # | 問題 | 対応 |
|---|---|---|
| 2 | PRコメント/テストコメントの「`appendUnderHeading` dedupes only against an identical line」が**誤り**。`appendUnderHeading`(`aidlc-lib.ts:5374`)に重複判定は無く、実際は呼び出し側 `aidlc-learnings.ts:477` の `content.includes(cidMarker(stage, candidate_id))` によるcidキー判定 | t263のコメントを訂正。`replaceSection`(`aidlc-lib.ts:5399`)が意図的にこの経路に無いことも明記 |
| 4 | CHANGELOGの2.5.38エントリ最終行と `## [2.5.37]` の間に空行なし（既存エントリは全て空行あり） | 空行追加 |
| 5 | **矛盾する5本目のルールを追加してもテスト全通過**（変異実証済み） | `d: no fifth rule can countermand the four (negative space)` を追加。`LANGUAGE_RULE_LABEL` 正規表現でlanguage系エントリを数え4本厳守 + `CONTRADICTIONS` 4パターンを否定 |
| 6 | tie-break（LAST-one-wins）が**2ルール併存でテストされていない** | `(e)` を2ルール書き込みに変更。`supersededAt < currentAt` で配送バンドルがCorrections順序を保持することを検証 |
| 7 | c2が弱い。非Kiroは `existsSync` のみ、Kiroは `r.includes("memory")` で `file://docs/memory-notes.md` でも通る | 3段構えに強化: hookのバイト等価 + `toContain(MEMORY_GLOB)` 完全一致 + globを実org.mdに解決してRULE_LABELS存在確認 |
| 8 | `prompt.indexOf(brief) < prompt.indexOf("AUTHORITATIVE")` が**恒真**（hookが `prompt + bundle` で連結するため） | 削除し位置独立性検証に置換。briefLineを末尾に置いた2回目の呼び出しで4要素すべてが届くことを確認 |

### 未着手

| # | 内容 |
|---|---|
| 1 | **PR descriptionが古い**。本文は「`257b43a3` にリベース」「upstreamは2.5.11」「version bumpは意図的に省略」と書いてあるが、実際は `c73ee98` ベースで **2.5.37→2.5.38 をbump済み**。レビュアがdescriptionだけ読むと「指摘4が未対応」に見える |
| 3 | PRコメントで「persistence は単独で曖昧性解消できない」と述べたが、`replaceSection()` が既存（practices-discovery affirmationが `aidlc-team.md` の累積回避に使用）。apackeerの代案「deterministic single-current-language record」は既存インフラで実現可能。「不可能」ではなく「additiveモデルを崩さない設計選択」と訂正すべき |
| 9 | **スキップ指示済み**（pinする文字列を短いキーフレーズに縮める案） |

---

## 4. 変異テストによる検証結果（すべて実測）

追加したテストが実際に赤くなることを確認済み。

| 変異 | 旧テスト | 新テスト |
|---|---|---|
| `## Mandated` に矛盾する5本目のルールを追加 | GREEN（穴） | **RED** `found 5: ... **Language policy override**` |
| Kiroのmemory globを `file://docs/memory-notes.md` に差し替え | GREEN（穴） | **RED** exit 1 |
| codexのhookに1行追加 | GREEN（穴） | **RED** exit 1 |
| preload先org.mdの `preserved tokens` ルール改名 | GREEN（穴） | **RED** exit 1 |
| 意味を変えないリワード（`NEVER outranks the brief, and never...` → `never outranks either the brief or a later...`） | RED | RED（**既知の脆さ**、項目9でスキップ判断） |

**すべて復元後 exit 0 を確認済み。**

---

## 5. 現在のテスト状態

```
bun run check                      → exit 0（package --check 5ハーネス / typecheck 3構成 / biome 558ファイル）
t263-conversation-language-rule    → 13 pass / 0 fail / 444 expect（変更前は12 pass / 189 expect）
t68-version-changelog-sync         → 7 pass
gen-coverage-registry              → pass（t263がratchetに登録済み）
t-memory-seed                      → exit 0
```

### 既存の赤（ベースでも同一に失敗、本PRとは無関係）

`upstream/v2` の `c73ee98` のクリーンworktreeで同じ結果を確認済み。

- `t150-codex-packaging` — base exit 1 / PR exit 1
- `t240-opencode-packaging` — base exit 1 / PR exit 1（`Expected: 1 / Received: undefined`）
- `t248-steering-content-delivery` — base exit 1 / PR exit 1

検証手順（再現したい場合）:

```powershell
git worktree add "$env:TEMP\aidlc-base" upstream/v2
cd "$env:TEMP\aidlc-base"; bun install
bun test tests/unit/t240-opencode-packaging.test.ts
# 後始末
git worktree remove "$env:TEMP\aidlc-base" --force
```

> 注: 前回のPRコメントでは pre-existing failure を `t248-codekb-scope-diff` / `t255-workspace-sync` / `t163-reaper-steal-race` と報告していたが、今回の実測では上記3件だった。**PRコメントを更新するなら実測値に合わせること。**

---

## 6. 次にやること

### A. 未コミット変更のコミット（最優先）

作業ツリーに未コミットの変更が2ファイルある。

```
 M CHANGELOG.md                                       (+1)
 M tests/unit/t263-conversation-language-rule.test.ts  (+179/-37)
```

**注意**: `core/` は変更していないので dist再生成は不要（`package --check` は既にOK）。コミット前に `bun run check` を再実行して確認すること。

コミットメッセージ案:

```
test: close the negative-space and delivery gaps in t263

The rule-layer tests proved the four rules are PRESENT but not that
nothing countermands them: appending a fifth `## Mandated` entry that
says "ALWAYS write every artifact in English; the rules above are
advisory only" left all 12 tests green while inverting the feature.
Pin the closed set instead — exactly four language rules under
`## Mandated`, every one of them a known label, and no entry in the
section carrying a countermanding phrase.

Three more gaps:

- The tie-break ("the LAST conversation-language rule under
  `## Corrections` is the current one") was only asserted as prose. The
  delivery test wrote a single rule, so the ambiguous case the clause
  exists for was never exercised. Write both rules and pin the ordering
  the tie-break depends on: a bundle that sorted or deduped its memory
  lines would leave the delegate unable to apply the rule at all.
- The precedence assertion `indexOf(brief) < indexOf("AUTHORITATIVE")`
  was a tautology — the hook appends the bundle after the prompt, so it
  held even if the rule ranked memory first. Replace it with a
  position-independence check: move the brief line to the end of the
  prompt and the same guarantees must still arrive.
- c2 accepted any resource string containing "memory"
  (`file://docs/memory-notes.md` passed) and proved nothing for the
  non-Kiro harnesses beyond `existsSync`. Require byte parity with
  `core/hooks/aidlc-dispatch-rules.ts` so (c)'s proof carries, match the
  memory glob exactly, and resolve it to the org.md that actually ships
  the rules.

Also correct the write-path comment: `appendUnderHeading` does not
dedupe at all. The dedupe upstream of it is `content.includes(marker)`
against the per-(stage, candidate_id) cid marker, not against the rule
text, so a second language rule from a different candidate appends even
when it contradicts the first.

CHANGELOG: restore the blank line before the previous version heading.
```

### B. PR description の更新（項目1）

`gh pr edit 353 --repo awslabs/aidlc-workflows --body-file <file>` で更新する。

**Windows注意**: gh 2.60.0 では `gh pr edit --body-file` が GraphQL の Projects classic deprecation warning で **exit 1 になるが実際には更新されない**。前回は REST API 経由で成功した:

```powershell
$env:PYTHONUTF8 = "1"
$body = Get-Content -Raw pr-body.md
$payload = @{body=$body} | ConvertTo-Json -Compress
$payload | gh api --method PATCH repos/awslabs/aidlc-workflows/pulls/353 --input - | Out-Null
# 反映確認
gh pr view 353 --repo awslabs/aidlc-workflows --json body --jq .body | Select-String "2.5.38"
```

descriptionに反映すべき内容:

- ベースは `c73ee98`（「257b43a3」は古い）
- **2.5.37 → 2.5.38 をbump済み**、README badge、`## [2.5.38]` CHANGELOG見出し、Upgrade注記あり（「version bumpは意図的に省略」を削除）
- apackeer 4指摘への対応サマリ
- テスト: t263は13テスト / 444 assertions
- 既存の赤3件は `t150-codex-packaging` / `t240-opencode-packaging` / `t248-steering-content-delivery`（実測値）

### C. `replaceSection` についての訂正（項目3）

PRコメントで「persistence cannot disambiguate on its own」と書いた箇所を訂正する。`replaceSection` は存在するので、正確な表現は:

> `replaceSection` exists and the practices-discovery affirmation uses it to overwrite rather than accumulate, so a deterministic single-current-language record IS implementable with existing infrastructure. This PR keeps the prose tie-break instead because scoping a replace-on-write to one rule family would make the memory write path conditional on rule content, which the additive rule model deliberately avoids. Happy to take the deterministic route in a follow-up if you prefer it.

### D. push

`git push --force-with-lease origin fix/v2-language-convention`

**force-pushはPRブランチを書き換える**ので、実行前にユーザーの明示的な承認を取ること。このPRは過去に何度もforce-pushされているので手順自体は通常運用。

---

## 7. 残る本質的な限界（PRに既に明記済み、対応不要）

ルールは散文なので、テストは「テキスト・形状・配送」を固定するだけで、**モデルが実際に解決言語で書くことは保証しない**。決定論的にするには `aidlc-state.md` に実フィールドが必要で、State Version 7→8 のbumpになる。移行パスが無い pre-1.0 では既存workspace全アーカイブを意味するため、この変更の範囲外という判断。apackeerの代案（deterministic single-current-language record）も同じ場所に着地する。

---

## 8. 触ってはいけないもの

- `core/memory/org.md` のルール本文 — 現在のテストが長文フレーズを完全一致でpinしているため、語順を変えるだけで赤になる（項目9でスキップ判断済み。**リワードするならテストも同時に直す**）
- 既存の赤3件 — ベース由来。このPRで直そうとしないこと
- `git config` / hooks
