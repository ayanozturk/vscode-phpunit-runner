# PHPUnit Runner

PHPUnit Runner is a VS Code extension for discovering and running PHPUnit tests directly from the editor and the Testing view.

It parses PHPUnit test files, organizes them by folder structure, and lets you run the current file, the test at the cursor, or discovered tests from the VS Code test explorer.

## Features

- Discovers PHPUnit test files across the workspace (vendor and `node_modules` excluded by default)
- Auto-detects `phpunit.xml` / `phpunit.xml.dist` and reloads when they change
- Detects test methods by:
  - `test*` method names
  - `@test` docblocks
  - `#[Test]` and `#[PHPUnit\Framework\Attributes\Test]` attributes
- Organizes tests in the Testing panel by workspace, folders, files, classes, and methods
- Maps PHPUnit JUnit output onto individual Test Explorer items (pass / fail / skip)
- Debug and coverage run profiles (Xdebug listener + Clover overlay)
- Remote execution via a command template (Docker Compose, Laravel Sail, DDEV, SSH)
- Host-to-remote path mappings so failures and coverage open the local file
- Run all, rerun last, run failed, and run by `#[Group]` / `@group`
- Discovers tests from `phpunit.xml` testsuites when present
- Shows assertion failures with file locations in the Test Results panel
- Run the current file from the editor title or context menu
- Run the test at the current cursor position
- Shows PHPUnit output in a dedicated output channel
- Supports local execution and Docker container execution

## Installation

Install from the VS Code Marketplace.

## Configuration

Core settings:

- `phpunitRunner.phpExecutable`
- `phpunitRunner.phpunitCommand`
- `phpunitRunner.configurationFile`
- `phpunitRunner.workingDirectory`
- `phpunitRunner.additionalArgs`
- `phpunitRunner.phpArgs`
- `phpunitRunner.command`
- `phpunitRunner.paths`
- `phpunitRunner.environment`
- `phpunitRunner.saveBeforeTest`
- `phpunitRunner.continuousTesting` to rerun tests in a PHP file when it is saved
- `phpunitRunner.testFileGlobs`
- `phpunitRunner.excludeGlobs`
- `phpunitRunner.debuggerConfig`
- `phpunitRunner.xdebugPort` (set to `0` to choose an available port automatically)

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

### Laravel Sail / Docker Compose

```json
{
  "phpunitRunner.command": "docker compose exec -u sail laravel.test ${php} ${phpargs} ${phpunit} ${phpunitargs}",
  "phpunitRunner.paths": {
    "${workspaceFolder}": "/var/www/html"
  }
}
```

### DDEV

```json
{
  "phpunitRunner.command": "ddev exec ${php} ${phpargs} ${phpunit} ${phpunitargs}"
}
```

### SSH

```json
{
  "phpunitRunner.command": "ssh user@host \"cd ${cwd} && ${php} ${phpargs} ${phpunit} ${phpunitargs}\"",
  "phpunitRunner.paths": {
    "${workspaceFolder}": "/app"
  }
}
```

### Remote reports

JUnit and Clover reports are written under `.phpunit-runner` and read from the workspace on the VS Code host. Remote command and Docker setups must expose that directory through a shared or mounted workspace, or retrieve the generated reports before the command finishes. Without a readable JUnit report, tests are marked skipped as unverified; without a readable Clover report, coverage is unavailable. The output channel reports these cases.

## Commands

- `PHPUnit Runner: Refresh Tests`
- `PHPUnit Runner: Run Current File`
- `PHPUnit Runner: Run Test At Cursor`
- `PHPUnit Runner: Run All Tests`
- `PHPUnit Runner: Rerun Last Run`
- `PHPUnit Runner: Run Failed Tests`
- `PHPUnit Runner: Run By Group`
- `PHPUnit Runner: Show Output`

## Repository

- Source: https://github.com/ayanozturk/vscode-phpunit-runner
- License: MIT
