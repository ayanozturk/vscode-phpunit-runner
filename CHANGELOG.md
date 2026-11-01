# Changelog

## Unreleased

## 0.5.1 - 2026-11-01

### Added

- Configure how many slow, flaky, failed, and errored test insights appear per workspace.
- Rerun the latest mapped failed or errored tests in one command, clear insight history for the active workspace folder, and copy a bounded Markdown insight report.

### Improved

- Suggest generated PHP test destinations from the project’s existing `Unit` or `Feature` layout and source folders.
- Add PHPUnit 13.4+ per-test coverage details for uniquely matched local Composer PHPUnit methods, retaining Clover aggregate fallback elsewhere.
- Clear process termination escalation timers when children exit, and cover spawn/cancellation lifecycle edge cases.
- Clean up the roadmap into prioritized remaining work and acceptance criteria.
- Preserve earlier PHPUnit Runner output when listing supported AI CLI tools.
- Reduce transient allocations when selecting slow tests from large run histories, with regression coverage for out-of-order completion timestamps.
- Extract stable test hierarchy IDs into a focused module and add parser groundwork for PHPUnit 13.4's test-to-code coverage report.
- Detect Pest and ParaTest Composer shims across Windows `.bat`, `.cmd`, and `.exe` forms.
- Read Clover file totals accurately when files contain multiple classes, with a class-metric fallback when file totals are absent.
- Isolate and test Composer framework metadata parsing used by project diagnosis.
- Speed up test discovery by reusing masked PHP class bodies during method and data-provider scanning.
- Make Test Insights searchable by workspace, source location, and explanatory details.
- Isolate remote report transfer execution and preserve correct result mapping for identical tests across workspace roots.
- Detect Codex, GitHub Copilot CLI, and Claude Code and generate reviewed PHPUnit/Pest test files from selected PHP code.
- Improve extension-host compatibility coverage for the minimum supported VS Code version and add run-history scale benchmarks to CI.
- Resolve insight actions to exact discovered method or data-set identities, and include concise, bounded failure messages in history.
- Ignore PHP comments and string literals when validating generated unit-test code.
- Reject truncated per-test coverage reports and avoid attributing coverage to ambiguous class or method identities.
- Extract PHP non-code masking, failure-message normalization, and test-selection planning into focused, tested modules.

## 0.5.0 - 2026-11-01

### Added

- Added an opt-in Parallel Tests profile for Pest and ParaTest, with configurable workers and scoped execution.
- Added native continuous testing support, workspace-local slow and flaky test insights, and a command to clear insight history.
- Added dynamic PHPUnit provider discovery, project diagnostics, and remote JUnit/Clover report transfer.
- Added named Clover declaration coverage and per-test coverage details when a single method or data set is selected.
- Added CI compatibility smoke checks for PHPUnit 10–13 and Pest 3–5.

### Improved

- Reduced parsing time for large PHP heredocs from seconds to milliseconds while keeping normal discovery performance stable.
- Improved remote path mapping, result matching, and Windows Pest parallel-runner detection.
- Improved test insight navigation and output clarity.
