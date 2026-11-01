# PHPUnit Runner Roadmap

## Goal

Provide a dependable, responsive PHPUnit and Pest workflow in VS Code, from discovery through local, containerized, and remote execution. Keep results trustworthy, make useful feedback quick to reach, and keep AI-assisted test authoring explicit and reviewable.

## Delivered capabilities

- **Discovery and execution:** Static discovery, runtime PHPUnit provider discovery with fallback, incremental refresh, continuous testing, local and Docker execution, custom remote commands and report transfer, and an opt-in parallel profile for supported Pest and ParaTest projects.
- **Results and insights:** JUnit mapping, Clover coverage, supported exact per-test coverage, bounded local history, slow-test and flaky-candidate views with recent outcome sequences, copyable insight summaries, searchable insight pickers, and configurable output including compact custom failure messages.
- **AI test authoring:** Detect Codex CLI, GitHub Copilot CLI, and Claude Code only. Generate PHPUnit or Pest tests from selected PHP, confirm before sending context, preview a diff, and require confirmation before saving under `tests/`.
- **Quality and performance:** Adversarial report and process-output tests, focused pure-module coverage, PHP/framework compatibility jobs, VS Code extension-host checks, and result-count-checked scale benchmarks.

## Roadmap

### P1 — Keep orchestration modular

**Status: Active**

- Continue extracting deterministic discovery, suite matching, and result-mapping logic from VS Code orchestration when ownership is clear.
- Keep filesystem, process, and VS Code effects at module edges.
- Add characterization tests before moving behavior; preserve test identity, cancellation, workspace ownership, and report fallback behavior.

**Complete when:** focused modules have stable interfaces and tests, orchestration is smaller, and behavior remains unchanged except for covered compatibility fixes.

### P2 — Protect result correctness

**Status: Active**

- Add adversarial cases for malformed reports, duplicate identities, repeated records, missing paths, interrupted processes, and unsupported runner versions.
- Preserve exact test identities and source paths; never infer per-test coverage from aggregate data.
- Keep unsupported or unavailable fields visibly unavailable rather than reporting guessed results.

**Complete when:** supported paths map exact results and unsupported or incomplete paths produce a clear, unverified or unavailable outcome.

### P3 — Measure before optimizing

**Status: Active**

- Maintain discovery, result-index, and run-history benchmarks at representative 1k/10k workloads and larger history sizes.
- Assert result counts; compare repeated measurements without machine-dependent CI thresholds.
- Retain an optimization only when it improves measured workloads without changing results.

**Current evidence:** Node 22.20.0 on darwin/arm64: 10k discovery median 100.7 ms; 10k result-index build 11.9 ms, method query 2.7 ms, file-backed Pest lookup 13.5 ms, and no-file Pest lookup 346.1 ms. For 1M history records, slowest-test and flaky-candidate queries measured 53.7 ms and 46.9 ms. The completed-window guard previously reduced flaky lookup from 121.4 ms to 47.5 ms in a controlled A/B. Reducing the trigram posting cap regressed no-file lookup to 1,010.8 ms and was discarded.

**Complete when:** benchmarks remain comparable across revisions and every retained performance change has before/after evidence and correctness coverage.

### P4 — Close compatibility and integration gaps

**Status: Active**

- Keep Node, VS Code, PHPUnit, and Pest CI matrices aligned with declared support.
- Add integration fixtures for runtime listing, remote report retrieval, parallel scope, cancellation, and coverage-driver behavior.
- Keep CLI smoke checks isolated from the extension's own package dependencies.

**Complete when:** supported combinations pass compile, unit, extension-host, package, and dependency-audit checks, and important fallback paths have regression coverage.

### P5 — Make test feedback actionable

**Status: Active**

- Keep insight reruns mapped to the exact discovered method or data set, and show enough recent outcomes to explain flaky candidates.
- Verify AI context consent, output review, destination choice, and confirmed save behavior through extension-level tests.

**Complete when:** insight run actions preserve exact discovered scope, and AI tool detection, context consent, output review, destination selection, and explicit save behavior are covered by tests and documented clearly.

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
