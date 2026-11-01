# PHPUnit Runner Roadmap

## Goal

Provide a dependable, responsive PHPUnit and Pest workflow in VS Code, from discovery through local, containerized, and remote execution. Keep results trustworthy, make useful feedback quick to reach, and keep AI-assisted test authoring explicit and reviewable.

## Delivered capabilities

- **Discovery and execution:** Static discovery, runtime PHPUnit provider discovery with fallback, incremental refresh, continuous testing, local and Docker execution, custom remote commands and report transfer, and an opt-in parallel profile for supported Pest and ParaTest projects.
- **Results and insights:** JUnit mapping, pure method and data-set result planning, Clover coverage, supported exact per-test coverage, bounded local history, stable-identity insight reruns, configurable insight counts, latest failure and error summaries with bounded first-line messages, batch rerun of recent test problems, copyable insight summaries, searchable insight pickers, and compact custom failure output.
- **AI test authoring:** Detect Codex CLI, GitHub Copilot CLI, and Claude Code only. The confirmation identifies source path and scope plus possible project context; generated PHPUnit/Pest output is previewed, and saving under `tests/` requires confirmation. Extension-host coverage verifies consent, review-before-apply, save, and cancel-before-run.
- **Quality and performance:** Adversarial report and process-output tests, focused pure-module coverage, PHP/framework compatibility jobs, VS Code extension-host checks, and result-count-checked scale benchmarks. Process output observer failures stop the child and reject with the original error.

## Roadmap

### P1 — Keep orchestration modular

**Status: Active**

- Continue extracting deterministic discovery and suite-matching logic from VS Code orchestration when ownership is clear; method/data-set result planning, test-selection arguments, failure-summary normalization, and PHP source masking now live in focused pure modules.
- Keep filesystem, process, and VS Code effects at module edges.
- Add characterization tests before moving behavior; preserve test identity, cancellation, workspace ownership, and report fallback behavior.

**Complete when:** focused modules have stable interfaces and tests, orchestration is smaller, and behavior remains unchanged except for covered compatibility fixes.

### P2 — Protect result correctness

**Status: Active**

- Add adversarial cases for malformed reports, duplicate identities, repeated records, missing paths, interrupted processes, and unsupported runner versions.
- Reject truncated optional coverage reports as a whole rather than exposing partial per-test coverage.
- Preserve exact test identities and source paths; never infer per-test coverage from aggregate data.
- Treat class/method identities that differ only by case as ambiguous when mapping exact per-test coverage.
- Keep unsupported or unavailable fields visibly unavailable rather than reporting guessed results.

**Complete when:** supported paths map exact results and unsupported or incomplete paths produce a clear, unverified or unavailable outcome.

### P3 — Measure before optimizing

**Status: Active**

- Maintain discovery, result-index, and run-history benchmarks at representative 1k/10k workloads and larger history sizes.
- Assert result counts; compare repeated measurements without machine-dependent CI thresholds.
- Retain an optimization only when it improves measured workloads without changing results.

**Current evidence (Node 22.20.0, darwin/arm64):**

- Latest multi-file smoke: 10k discovery 100.7 ms; result-index build 13.9 ms; method lookup 4.5 ms; file-backed Pest lookup 16 ms.
- Single-file Pest A/B, 7 build samples and 5 lookup sweeps: 1k lookup 25.7→8.3 ms, 5k 616→22.4 ms, 10k 2,418→66 ms. At 10k, build rose 8→63 ms and index memory rose 0.46 MiB.
- The per-file index retains at most 1,048,576 postings total; overflowed files exact-scan. The no-file Pest lookup cap change measured 345→58 ms at 10k. Benchmarks assert result counts and use no machine-specific timing gate.
- Other measured workloads: 1M history records took 65.7 ms for slow-test and 64.5 ms for flaky-candidate queries; discovery took 12.8 ms at 1k and 110.5 ms at 10k; scanning a 5k-line heredoc fixture took 25.4 ms.
- A top-K heap prototype for slowest-test selection did not yield consistent gains (63.9 ms then 71.2 ms versus a 68.3 ms baseline) and was discarded.
- A seven-iteration history benchmark measured slowest/flaky medians of 3.5/6.5 ms at 20k cases and 74.4/89.2 ms at 1M; result counts passed and no consistent optimization was identified.
- Repeated discovery and result-index benchmarks passed all result counts but showed run-to-run timing variance; no safe optimization was retained.
- A further seven-iteration discovery/result-index sweep also passed counts but showed similar timing variance, so no additional performance change was justified.
- Composer metadata decoding is now isolated from filesystem reads; the unit tests cover valid, missing, malformed, and incomplete metadata.
- Docker mapping fallback, normalization, and longest-prefix precedence now live in a tested pure helper.

**Complete when:** benchmarks remain comparable across revisions and every retained performance change has before/after evidence and correctness coverage.

### P4 — Close compatibility and integration gaps

**Status: Active**

- Keep Node, VS Code, PHPUnit, and Pest CI matrices aligned with declared support.
- Add integration fixtures for remote report retrieval and coverage-driver behavior; runner listing, parallel scope, and cancellation have existing coverage.
- Keep CLI smoke checks isolated from the extension's own package dependencies.
- Recent regressions cover nested JUnit suites, named data-set filter metacharacters, and latest reported failures/errors in Test Insights.

**Complete when:** supported combinations pass compile, unit, extension-host, package, and dependency-audit checks, and important fallback paths have regression coverage.

### P5 — Make test feedback actionable

**Status: Complete**

- Insight actions resolve persisted report identity to the exact discovered method or data set, fall back to the method when a reported row is unavailable, and use source location when identity is stale.
- Slow-test entries show their latest reported date; flaky entries retain the newest-first pass/fail sequence and latest date.
- Latest failed or errored entries include a normalized, first-line failure summary capped at 200 characters; stack traces are not persisted in history.
- Each workspace can configure the number of slow, flaky, and latest-problem insights shown (1–100; default 10).
- Unit coverage exercises method and data-set identity resolution; extension-host coverage verifies the action runs the selected method without widening to its data sets.
- The Command Palette can rerun the latest failed or errored tests whose report identity or source location maps to a discovered test.

**Complete when:** insight run actions preserve exact discovered scope and recent outcomes remain understandable.

## Support boundaries and acceptance criteria

- Framework scope is PHPUnit and Pest; other PHP test frameworks are out of scope.
- Runtime discovery falls back to static discovery when unsupported or unsuccessful; refresh preserves unchanged test identities.
- Workspace and folder selections run together where supported; parallel execution remains opt-in, preserves scope, and can be cancelled.
- Missing reports, failed transfers, and zero-test executions are never presented as verified passes.
- Per-test coverage is available only when the runner reports exact identities and supported source paths. Current support is local Composer PHPUnit 13.4+ with unique class/method identities; data sets, Docker/custom commands, and remote retrieval are unsupported. Clover remains the aggregate fallback.
- History stays in VS Code workspace state, bounded to the latest 100 runs per workspace, and includes only completed reported outcomes.
- AI generation supports Codex CLI, GitHub Copilot CLI, and Claude Code only. It asks before sending context, previews generated output, and saves only after explicit confirmation under the workspace `tests/` directory.

## Validation and delivery

- Run unit tests and compilation for code changes; add integration coverage when behavior crosses the VS Code, process, runner, or report boundary.
- Run relevant scale benchmarks for performance changes and compare against a baseline without hard-coded timing gates.
- Run tests before each commit. After each commit, build and install the extension locally; push completed commits using the established repository workflow.

## References

- [PHPUnit CLI](https://docs.phpunit.de/en/12.5/cli-options.html)
- [PHPUnit 13.4 code coverage](https://docs.phpunit.de/en/13.4/code-coverage.html)
- [VS Code Testing API](https://code.visualstudio.com/api/extension-guides/testing)
- [Pest optimization](https://pestphp.com/docs/optimizing-tests)
- [ParaTest](https://github.com/paratestphp/paratest)
- [PHPUnit Test Workbench](https://marketplace.visualstudio.com/items?itemName=chiefmyron.phpunit-test-workbench)
- [PHP Tools](https://open-vsx.org/extension/DEVSENSE/phptools-vscode)
