# PHPUnit Runner

PHPUnit Runner is a VS Code extension for discovering and running PHPUnit tests directly from the editor and the Testing view.

It parses PHPUnit test files, organizes them by folder structure, and lets you run the current file, the test at the cursor, or discovered tests from the VS Code test explorer.

## Features

- Discovers PHPUnit test files across the workspace
- Detects test methods by:
  - `test*` method names
  - `@test` docblocks
  - `#[Test]` attributes
- Organizes tests in the Testing panel by workspace, folders, files, classes, and methods
- Run the current file from the editor title
- Run the test at the current cursor position
- Shows PHPUnit output in a dedicated output channel
- Supports local execution and Docker container execution

## Installation

Install from the VS Code Marketplace, or build locally:

```sh
npm install
make install
```

## Configuration

Core settings:

- `phpunitRunner.phpExecutable`
- `phpunitRunner.phpunitCommand`
- `phpunitRunner.configurationFile`
- `phpunitRunner.workingDirectory`
- `phpunitRunner.additionalArgs`
- `phpunitRunner.testFileGlobs`

Docker settings:

- `phpunitRunner.docker.enable`
- `phpunitRunner.docker.command`
- `phpunitRunner.docker.container`
- `phpunitRunner.docker.workspacePath`
- `phpunitRunner.docker.execArgs`

### Local example

```json
{
  "phpunitRunner.phpunitCommand": "vendor/bin/phpunit",
  "phpunitRunner.configurationFile": "phpunit.xml"
}
```

### Docker example

```json
{
  "phpunitRunner.docker.enable": true,
  "phpunitRunner.docker.container": "app",
  "phpunitRunner.docker.workspacePath": "/var/www/html",
  "phpunitRunner.phpunitCommand": "vendor/bin/phpunit"
}
```

## Commands

- `PHPUnit Runner: Refresh Tests`
- `PHPUnit Runner: Run Current File`
- `PHPUnit Runner: Run Test At Cursor`
- `PHPUnit Runner: Show Output`

## Build and Publish

```sh
make package
```

To publish:

```sh
export VSCE_PAT=your_marketplace_token
make publish
```

## Repository

- Source: https://github.com/ayanozturk/vscode-phpunit-runner
- License: MIT
