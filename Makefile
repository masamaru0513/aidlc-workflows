.PHONY: all clean build-kiro

DIST := dist

all: build-kiro

clean:
	rm -rf $(DIST)

build-kiro:
	@bash targets/kiro/build.sh
