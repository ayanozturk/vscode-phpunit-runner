# PHPUnit Runner

Run PHPUnit and Pest tests from your PHP editor, see failures in VS Code’s Testing view, and debug with Xdebug—all without leaving your workspace.

PHPUnit Runner discovers tests as you work and gives you fast access to the test under your cursor, the current file, failed tests, groups, or the full suite. Use a local project, Docker, or a remote command such as Laravel Sail, DDEV, or SSH.

## Why PHPUnit Runner

- **Find tests where you work.** Browse discovered PHPUnit classes and methods, plus Pest `test()` and `it()` cases grouped by `describe()` context, in the native Testing view.
- **Run configured suites directly.** Named suites from `phpunit.xml` appear as groups in the Testing view and run with PHPUnit’s suite selection, with individual results mapped back to discovered tests.
- **Run the right amount.** Run a test at the cursor, the open file, failed tests, a group, or the whole suite. Rerun the last selection when you need another pass.
- **Run or debug inline.** Use the Run Test and Debug Test actions shown above discovered PHPUnit methods and Pest cases.
- **Choose speed or compatibility.** Keep the serial Run Tests profile as the default, or select Parallel Tests when Pest is declared and installed or ParaTest is installed. Set the worker count with `phpunitRunner.parallel.processes`.
- **Work with data providers.** Literal PHPUnit `#[TestWith]` and `#[TestWithJson]` rows appear beneath each test before the first run; data-provider cases discovered from results can also be run individually.
- **See provider cases before running.** Same-class PHPUnit providers that return literal arrays are expanded into selectable data sets in the Testing view, whether referenced by `#[DataProvider]` or `@dataProvider`.
- **Handle dynamic PHPUnit providers.** When a provider cannot be evaluated statically, a PHPUnit list-only discovery pass enumerates its data sets; each case can then be run independently.
- **Run Pest data sets individually.** Literal arrays and inline generators with literal `yield` values passed to Pest’s `->with()` appear under their test, including chained data sets.
- **Understand failures quickly.** See colored outcomes, assertion messages, source locations, and a short PHP code frame for readable local failure files in VS Code’s Test Results panel.
- **Choose your test output.** Switch between detailed per-test results, a compact progress summary, or plain per-test lines.
- **Debug and measure coverage.** Start an Xdebug session for a selected test and inspect statement and named method coverage in the editor; supported single-test coverage can also be inspected per test.
- **Fit your environment.** Run locally, through Docker, or with a command template for Laravel Sail, DDEV, SSH, and other remote setups. Host-to-remote path mappings keep results connected to local files across multi-root workspaces.
- **Diagnose setup and remote results.** Check runner, configuration, PHP, and report readiness without starting tests; retrieve JUnit and coverage files from custom remote commands when they are not on a shared mount.
- **Act on test insights.** Review slow tests, possible flaky candidates, and each test’s latest failure or error from recent verified runs. Flaky candidates show their recent pass/fail sequence newest first. Open a reported source location, run a matching discovered test, or copy the insight summary and full source location from the picker.
- **Draft tests with your AI CLI.** Detect Codex, GitHub Copilot CLI, or Claude Code, generate PHPUnit or Pest tests from selected PHP, review the diff, and run the saved test from VS Code.
- **Keep results current.** Refresh discovery as PHP files, PHPUnit configuration, or Composer dependencies change, or enable continuous testing to rerun a saved file.

## Get started

1. Install **PHPUnit Runner** from the VS Code Marketplace.
2. Open a PHP project with PHPUnit installed through Composer. If Pest is declared in `composer.json`, `vendor/bin/pest` is selected automatically; otherwise the runner looks for `vendor/bin/phpunit` or `phpunit` on `PATH`.
3. Open the **Testing** view to browse tests, or use the editor’s Run Test and Run File commands.

The runner reads `phpunit.xml` or `phpunit.xml.dist` when available. You can also set an explicit executable and configuration file in your workspace settings.

### AI-assisted test generation

Run **PHPUnit Runner: Detect AI CLI Tools** to list supported Codex, GitHub Copilot, and Claude Code executables found on `PATH`. Choose **PHPUnit Runner: Generate Unit Tests with AI** from the Command Palette or a PHP editor context menu to generate a test for the selected code; with no selection, the active PHP file is used. If exactly one supported CLI is installed, it is used directly; if several are installed, choose one. The runner detects PHPUnit or Pest and includes the project test configuration and a matching existing test example when available.

Before sending anything, the confirmation names the source path and states whether it will send your selection or the entire file. It also lists the project context that may be included: Composer test settings, a PHPUnit configuration excerpt, and one existing test example when available. The selected local CLI may send this context to its configured AI provider. It runs from a temporary directory in its read-only or planning mode; Copilot CLI also denies write, shell, and URL tools. Generated PHP is shown in a diff against the chosen file under the workspace `tests` folder; the save dialog suggests a `Unit` or `Feature` path based on the project’s existing test layout and mirrors source subfolders where possible. The extension saves only after you choose **Apply Test File**. You can then run the generated test through PHPUnit Runner. Authentication remains managed by the selected CLI.

## Features

- Discovers PHPUnit methods marked with a `test*` name, `@test` docblock, or `#[Test]` attribute.
- Shows static method-level PHPUnit `#[TestDox('...')]` descriptions in the Testing view while keeping the actual method name for execution.
- Discovers same-class PHPUnit `#[DataProvider('providerMethod')]` or `@dataProvider providerMethod` rows when the provider returns a literal array, including named cases, before the first run.
- Uses PHPUnit's machine-readable test listing to discover dynamic provider rows when static analysis cannot resolve them; unsupported runner versions keep static discovery available.
- Supports VS Code's native continuous test action on the Run Tests profile. The optional `phpunitRunner.continuousTesting` setting remains available to rerun a saved PHP file automatically.
- Discovers literal PHPUnit `#[TestWith([...])]` and `#[TestWithJson('...')]` rows before the first run, showing numeric labels such as `#0` or custom names such as `positive pair` as selectable data-set tests.
- Discovers function-style Pest `test()` and `it()` cases with literal string names.
- Discovers statically declared Pest `dataset()` values, `->with([...])` data sets, and inline generator closures with literal `yield` values as selectable child tests, including chained data sets.
- Groups Pest tests inside named `describe()` blocks so each context can be run as a unit.
- Groups discovered tests by named suites in `phpunit.xml`, respecting directory prefixes and suffixes; files not assigned to a suite stay grouped by folder.
- Shows discovered method and workspace counts when choosing a PHPUnit `@group` or `#[Group]` to run.
- Runs workspace and folder selections in one PHPUnit process, and batches multiple selected files from the same workspace; individual methods and data sets stay narrowly filtered.
- Indexes JUnit results for fast status mapping, even when a run contains thousands of tests.
- Adds inline Run Test and Debug Test actions above each discovered test.
- Maps JUnit results to individual tests and reports assertion failure locations.
- Matches PHPUnit classes and methods without case sensitivity, maps remote paths in failure messages at directory boundaries, and preserves unrelated sibling paths.
- Adds PHPUnit data sets to their method after the first run so each data set can be run separately.
- Supports run, debug, and coverage profiles, plus commands to run all, rerun the last selection, run failed tests, or choose a group.
- Supports local and Docker execution, custom remote command templates, environment variables, and host-to-remote path mappings.
- Detects Codex, GitHub Copilot CLI, and Claude Code on `PATH` and can generate reviewed PHPUnit/Pest test files through the selected CLI.
- Offers an opt-in Parallel Tests profile for supported Pest and ParaTest projects, preserving selected scope and reported JUnit results. Unsupported application and opaque custom commands show an explanatory error.
- Reports Clover statement and named declaration coverage, including method execution totals when available. PHPUnit 13.4+ projects using the local Composer runner can also show per-test covered lines when test identities match exactly; aggregate Clover coverage remains available for other runners.
- Adds isolated CLI smoke checks for supported PHPUnit 10–13 and Pest 3–5 releases in CI, covering runtime test listing, JUnit reports, and Pest parallel execution.
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
- `phpunitRunner.remote.reportTransferCommand`
- `phpunitRunner.paths`
- `phpunitRunner.environment`
- `phpunitRunner.saveBeforeTest`
- `phpunitRunner.clearOutputOnRun` (defaults to `true`)
- `phpunitRunner.output.preset` (`collision`, `progress`, `pretty`, or `summary`)
- `phpunitRunner.output.sourceSnippetContextLines` (source lines shown before and after a failure, from 0 to 5)
- `phpunitRunner.continuousTesting`
- `phpunitRunner.parallel.processes` (defaults to `2`, range `1`–`64`)
- `phpunitRunner.testFileGlobs`
- `phpunitRunner.excludeGlobs`
- `phpunitRunner.debuggerConfig`
- `phpunitRunner.xdebugPort` (set to `0` to choose an available port automatically)

Run **PHPUnit Runner: Show Test Insights** from the Command Palette to see the slowest reported test cases, possible flaky candidates, and the latest failed or errored outcome for each test. Set `phpunitRunner.insights.limit` (1–100, default 10) to change how many entries appear for each insight type. Failure entries include a short first-line message when PHPUnit provides one. Flaky entries show the recent pass/fail sequence, newest first. Select an item to open its reported file and line; use its Run button to execute the matching discovered test when the report identity maps to one, or its Copy button to copy the summary and full source location. **PHPUnit Runner: Run Latest Test Problems** reruns the mapped failed or errored tests from each workspace folder. History stays in VS Code workspace state, keeps up to 100 runs per workspace, and only includes completed cases from readable JUnit reports. **PHPUnit Runner: Clear Current Workspace Test Insights** clears only the folder containing the active editor after confirmation. **PHPUnit Runner: Clear Test Insights History** asks you to confirm before clearing history for every folder in the current workspace.

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
- `summary`: aggregate counts plus concise details for failed and errored tests only; each reported failure location remains clickable, including when several tests fail.
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

The `testCase` template accepts `{status}`, `{icon}`, `{class}`, `{name}`, `{duration}`, `{file}`, `{line}`, and `{message}`. `{message}` inserts the first line of the test message, which is useful for compact failure summaries. For failed or errored tests, `{file}` and `{line}` use the reported failure location when available, then fall back to the test case location. Failure details accept `{file}` and `{line}` for `failureLocation`, and `{message}` for `failureMessage`. Set either failure template to an empty string to hide that detail. Use `icons` to override markers for `passed`, `failed`, `errored`, and `skipped` cases. Setting `colors` to `false` also removes standard ANSI color codes embedded in runner failure messages.

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

For a custom SSH command that cannot write directly to the host workspace, use `phpunitRunner.remote.reportTransferCommand` to copy reports after the test command exits. The command runs on the host and supports these shell-quoted placeholders:

- `${remoteJunitReport}` and `${localJunitReport}` (required in a configured transfer command)
- `${remoteCoverageReport}` and `${localCoverageReport}` (empty outside coverage runs)
- `${workspaceFolder}`

If the transfer command also copies Clover, guard that copy because coverage paths are empty during ordinary test runs.

For example, when the project is available over SSH and `scp` can reach the generated path:

```json
{
  "phpunitRunner.remote.reportTransferCommand": "scp user@example:${remoteJunitReport} ${localJunitReport}"
}
```

Use the same remote path mapping as the configured command so `${remoteJunitReport}` points to the generated file. Run **PHPUnit Runner: Diagnose Project** to inspect detected configuration and host report-directory readiness without executing the test runner.

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
- `PHPUnit Runner: Show Test Insights`
- `PHPUnit Runner: Run Latest Test Problems`
- `PHPUnit Runner: Clear Current Workspace Test Insights`
- `PHPUnit Runner: Show Output`

## Repository

- Source: https://github.com/ayanozturk/vscode-phpunit-runner
- License: MIT

Run `npm run benchmark:discovery` to measure parser time and memory for synthetic 1k- and 10k-test projects. Results are observational baselines, not CI thresholds.
Run `npm run benchmark:result-index` to measure JUnit index construction and method/Pest lookups at the same scales. CI records both benchmarks without machine-dependent pass/fail thresholds.
