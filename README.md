# PHPUnit Runner

Run PHPUnit and Pest tests from your PHP editor, see failures in VS Code’s Testing view, and debug with Xdebug—all without leaving your workspace.

PHPUnit Runner discovers tests as you work and gives you fast access to the test under your cursor, the current file, failed tests, groups, or the full suite. Use a local project, Docker, or a remote command such as Laravel Sail, DDEV, or SSH.

## Why PHPUnit Runner

- **Find tests where you work.** Browse discovered PHPUnit classes and methods, plus Pest `test()` and `it()` cases, in the native Testing view.
- **Keep suites organized.** Named suites from `phpunit.xml` appear as groups in the Testing view, with unmatched files kept in their folder structure.
- **Run the right amount.** Run a test at the cursor, the open file, failed tests, a group, or the whole suite. Rerun the last selection when you need another pass.
- **Understand failures quickly.** See pass, fail, and skipped results with assertion messages and source locations in VS Code’s Test Results panel.
- **Debug and measure coverage.** Start an Xdebug session for a selected test and inspect Clover coverage in the editor.
- **Fit your environment.** Run locally, through Docker, or with a command template for Laravel Sail, DDEV, SSH, and other remote setups. Host-to-remote path mappings keep results connected to local files.
- **Keep results current.** Refresh discovery as files or PHPUnit configuration change, or enable continuous testing to rerun a saved file.

## Get started

1. Install **PHPUnit Runner** from the VS Code Marketplace.
2. Open a PHP project with PHPUnit installed through Composer. If Pest is declared in `composer.json`, `vendor/bin/pest` is selected automatically; otherwise the runner looks for `vendor/bin/phpunit` or `phpunit` on `PATH`.
3. Open the **Testing** view to browse tests, or use the editor’s Run Test and Run File commands.

The runner reads `phpunit.xml` or `phpunit.xml.dist` when available. You can also set an explicit executable and configuration file in your workspace settings.

## Features

- Discovers PHPUnit methods marked with a `test*` name, `@test` docblock, or `#[Test]` attribute.
- Discovers function-style Pest `test()` and `it()` cases with literal string names.
- Groups discovered tests by named suites in `phpunit.xml`, with folder grouping for files that are not assigned to a suite.
- Maps JUnit results to individual tests and reports assertion failure locations.
- Supports run, debug, and coverage profiles, plus commands to run all, rerun the last selection, run failed tests, or choose a group.
- Supports local and Docker execution, custom remote command templates, environment variables, and host-to-remote path mappings.
- Can save dirty editors before a run and automatically rerun a saved PHP file.

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
- `phpunitRunner.continuousTesting`
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

### Local project

```json
{
  "phpunitRunner.phpunitCommand": "vendor/bin/phpunit",
  "phpunitRunner.configurationFile": "phpunit.xml"
}
```

### Docker

```json
{
  "phpunitRunner.docker.enable": true,
  "phpunitRunner.docker.container": "app",
  "phpunitRunner.docker.workspacePath": "/var/www/html",
  "phpunitRunner.phpunitCommand": "vendor/bin/phpunit"
}
```

### Laravel Sail or Docker Compose

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
