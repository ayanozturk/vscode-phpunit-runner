# Changelog

## Unreleased

### Improved

- Detect Pest and ParaTest Composer shims across Windows `.bat`, `.cmd`, and `.exe` forms.
- Read Clover file totals accurately when files contain multiple classes, with a class-metric fallback when file totals are absent.
- Isolate and test Composer framework metadata parsing used by project diagnosis.

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
