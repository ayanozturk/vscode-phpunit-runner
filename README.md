# PHPUnit Runner

Run PHPUnit and Pest tests from your PHP editor, see failures in VS Code’s Testing view, and debug with Xdebug—all without leaving your workspace.

PHPUnit Runner discovers tests as you work and gives you fast access to the test under your cursor, the current file, failed tests, groups, or the full suite. Use a local project, Docker, or a remote command such as Laravel Sail, DDEV, or SSH.

## Why PHPUnit Runner

- **Find tests where you work.** Browse discovered PHPUnit classes and methods, plus Pest `test()` and `it()` cases grouped by `describe()` context, in the native Testing view.
- **Run configured suites directly.** Named suites from `phpunit.xml` appear as groups in the Testing view and run with PHPUnit’s suite selection, with individual results mapped back to discovered tests.
- **Run the right amount.** Run a test at the cursor, the open file, failed tests, a group, or the whole suite. Rerun the last selection when you need another pass.
- **Run or debug inline.** Use the Run Test and Debug Test actions shown above discovered PHPUnit methods and Pest cases.
- **Work with data providers.** After a test run, PHPUnit data sets appear beneath their test and can be run individually.
- **Run Pest data sets individually.** Literal arrays and inline generators with literal `yield` values passed to Pest’s `->with()` appear under their test, including chained data sets.
- **Understand failures quickly.** See colored outcomes, assertion messages, source locations, and a short PHP code frame for readable local failure files in VS Code’s Test Results panel.
- **Choose your test output.** Switch between detailed per-test results, a compact progress summary, or plain per-test lines.
- **Debug and measure coverage.** Start an Xdebug session for a selected test and inspect Clover coverage in the editor.
- **Fit your environment.** Run locally, through Docker, or with a command template for Laravel Sail, DDEV, SSH, and other remote setups. Host-to-remote path mappings keep results connected to local files across multi-root workspaces.
- **Keep results current.** Refresh discovery as PHP files, PHPUnit configuration, or Composer dependencies change, or enable continuous testing to rerun a saved file.

## Get started

1. Install **PHPUnit Runner** from the VS Code Marketplace.
2. Open a PHP project with PHPUnit installed through Composer. If Pest is declared in `composer.json`, `vendor/bin/pest` is selected automatically; otherwise the runner looks for `vendor/bin/phpunit` or `phpunit` on `PATH`.
3. Open the **Testing** view to browse tests, or use the editor’s Run Test and Run File commands.

The runner reads `phpunit.xml` or `phpunit.xml.dist` when available. You can also set an explicit executable and configuration file in your workspace settings.

## Features

- Discovers PHPUnit methods marked with a `test*` name, `@test` docblock, or `#[Test]` attribute.
- Discovers function-style Pest `test()` and `it()` cases with literal string names.
- Discovers statically declared Pest `dataset()` values, `->with([...])` data sets, and inline generator closures with literal `yield` values as selectable child tests, including chained data sets.
- Groups Pest tests inside named `describe()` blocks so each context can be run as a unit.
- Groups discovered tests by named suites in `phpunit.xml`, respecting directory prefixes and suffixes; files not assigned to a suite stay grouped by folder.
- Shows discovered method and workspace counts when choosing a PHPUnit `@group` or `#[Group]` to run.
- Runs workspace and folder selections in one PHPUnit process, and batches multiple selected files from the same workspace; individual methods and data sets stay narrowly filtered.
- Indexes JUnit results for fast status mapping, even when a run contains thousands of tests.
- Adds inline Run Test and Debug Test actions above each discovered test.
- Maps JUnit results to individual tests and reports assertion failure locations.
- Adds PHPUnit data sets to their method after the first run so each data set can be run separately.
- Supports run, debug, and coverage profiles, plus commands to run all, rerun the last selection, run failed tests, or choose a group.
- Supports local and Docker execution, custom remote command templates, environment variables, and host-to-remote path mappings.
- Can save dirty editors before a run and automatically rerun a saved PHP file. Rapid saves to the same file are coalesced into one run.

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
- `phpunitRunner.clearOutputOnRun` (defaults to `true`)
- `phpunitRunner.output.preset` (`collision`, `progress`, `pretty`, or `summary`)
- `phpunitRunner.output.sourceSnippetContextLines` (source lines shown before and after a failure, from 0 to 5)
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

### Test output

Set `phpunitRunner.output.preset` to choose how structured PHPUnit results appear in VS Code’s Test Results output. Outcome markers and labels use ANSI colors. The detailed preset includes a short source snippet around a failure location when the referenced file is readable on the host.

- `collision` (default): a detailed line for each test, with duration and failure details.
- `progress`: one compact status marker per test followed by a result count.
- `summary`: aggregate counts plus concise details for failed and errored tests only.
- `pretty`: plain per-test status lines without status icons.

Use `phpunitRunner.output.format` to tailor status markers and failure details per workspace. For example, to hide colors and durations and shorten failure lines:

```json
{
  "phpunitRunner.output.format": {
    "colors": false,
    "duration": false,
    "testCase": "[{status}] {name}",
    "failureLocation": "at {file}:{line}",
    "failureMessage": "{message}",
    "sourceSnippet": false
  }
}
```

The `testCase` template accepts `{status}`, `{icon}`, `{name}`, and `{duration}`. Failure details accept `{file}` and `{line}` for `failureLocation`, and `{message}` for `failureMessage`. Set either failure template to an empty string to hide that detail. Use `icons` to override markers for `passed`, `failed`, `errored`, and `skipped` cases.

Set `phpunitRunner.output.sourceSnippetContextLines` to control how much PHP source appears around a failure location. It defaults to one line above and below; set it to `0` to show only the failing line, or choose up to `5` lines of context on each side.

When a JUnit report is unavailable, the runner keeps the raw process output so diagnostics such as `dd()` remain visible.

VS Code controls when the Test Results view opens. The setting is named `testing.openTesting` in older versions and `testing.automaticallyOpenTestResults` in newer versions; both accept `neverOpen`, `openOnTestStart`, or `openOnTestFailure`. To open results only when a test fails, add this to `.vscode/settings.json`:

```json
{
  "testing.automaticallyOpenTestResults": "openOnTestFailure"
}
```

This is useful when debugging a failure that prints raw PHP output such as `dd()`: the Test Results view opens on reported failures, and the PHPUnit Runner output channel retains the process output when no readable JUnit report is produced.

The PHPUnit Runner output channel is cleared once at the start of a run by default. Set `phpunitRunner.clearOutputOnRun` to `false` to keep earlier command output visible. In multi-root workspaces, the channel clears when any workspace included in that run has clearing enabled.

### Local project

```json
{
  "phpunitRunner.phpunitCommand": "vendor/bin/phpunit",
  "phpunitRunner.configurationFile": "phpunit.xml"
}
```

`phpunitRunner.phpunitCommand` can also include runner arguments. For example, use Laravel's local Artisan runner or run ParaTest with worker options:

```json
{
  "phpunitRunner.phpunitCommand": "artisan test"
}
```

```json
{
  "phpunitRunner.phpunitCommand": "vendor/bin/paratest --processes=4 --testsuite \"Integration Suite\""
}
```

Quote arguments that contain spaces so they remain one argument.

### Docker

```json
{
  "phpunitRunner.docker.enable": true,
  "phpunitRunner.docker.command": "docker compose",
  "phpunitRunner.docker.container": "app",
  "phpunitRunner.docker.workspacePath": "/var/www/html",
  "phpunitRunner.phpunitCommand": "vendor/bin/phpunit"
}
```

Set `phpunitRunner.docker.command` to `docker` for the Docker CLI or `docker compose` for the Compose subcommand. A quoted executable path can include spaces.

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

### Troubleshooting

#### A discovered test reports “No tests executed”

Discovery and PHPUnit execution are separate: the Testing view can find a test method that PHPUnit later excludes through its configuration, filters, or bootstrap. Open **PHPUnit Runner: Show Output** and check the exact command and working directory used for the run. Then try that command in a terminal; if PHPUnit also finds no matching test, review the project's `phpunit.xml` filters and test-suite paths, and confirm the selected method belongs to the configured suite. If PHPUnit does run tests but the Testing view cannot show individual outcomes, check the output channel for a JUnit report warning and follow the [remote reports](#remote-reports) setup guidance.

#### A full-suite run looks busy after PHPUnit finishes

Large suites can contain thousands of individual results. Workspace and folder selections run in one PHPUnit process, and the runner indexes the returned JUnit cases before updating each file and test. Choose `summary` to show counts and failure details only, or `progress` to keep one compact marker per test. To avoid opening the Test Results view after every successful run, set `testing.automaticallyOpenTestResults` to `openOnTestFailure` or `neverOpen`.

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
