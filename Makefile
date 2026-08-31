.PHONY: all build install package vsix publish clean dev test

NAME := $(shell node -p "require('./package.json').name")
VERSION := $(shell node -p "require('./package.json').version")
VSIX := $(NAME)-$(VERSION).vsix

all: build

## test: run unit tests
test:
	@echo "==> Running unit tests..."
	npm test

## build: compile TypeScript and bundle the extension
build: test
	@echo "==> Compiling TypeScript extension..."
	npm run compile
	@echo "==> Bundling extension..."
	npm run package

## install: build, package the VSIX, and install it in VS Code
install: package
	@echo "==> Installing extension in VS Code..."
	@CODE=$$(command -v code 2>/dev/null \
	  || ls "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" 2>/dev/null \
	  || ls "$$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" 2>/dev/null); \
	  if [ -z "$$CODE" ]; then echo "ERROR: 'code' CLI not found. Open VS Code -> Command Palette -> 'Install code command in PATH', then re-run make install."; exit 1; fi; \
	  "$$CODE" --install-extension $(VSIX)
	@echo "==> Done. Reload VS Code to activate the new version."

## vsix: build a versioned VSIX (e.g. aos-phpunit-0.2.0.vsix)
vsix: build
	@echo "==> Packaging $(VSIX)..."
	npx vsce package --no-dependencies -o $(VSIX)
	@test -f $(VSIX)
	@echo "    Wrote $(CURDIR)/$(VSIX)"

## package: alias for vsix
package: vsix

## publish: build, package, and publish the VSIX to the VS Code Marketplace
publish: package
	@if [ -z "$$VSCE_PAT" ]; then \
		echo "ERROR: VSCE_PAT is not set. Export your Marketplace token and re-run make publish."; \
		exit 1; \
	fi
	@echo "==> Publishing extension to Marketplace..."
	npx vsce publish --packagePath $(VSIX)
	@echo "==> Published $(VSIX)"

## clean: remove build artefacts
clean:
	@echo "==> Cleaning..."
	rm -rf dist out *.vsix

## dev: watch-compile TypeScript
dev:
	@echo "==> Watching TypeScript (Ctrl-C to stop)..."
	npm run watch