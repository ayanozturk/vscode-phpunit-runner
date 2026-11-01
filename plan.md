# PHPUnit Runner Roadmap

## Goal

Make PHPUnit Runner a dependable, responsive PHPUnit and Pest workflow in VS Code, from discovery through local, containerized, and remote execution. Keep results trustworthy, feedback fast, and optional AI-assisted test authoring explicit and reviewable.

## Delivered

- **Discovery and feedback:** Static discovery with runtime PHPUnit provider discovery and fallback; incremental refresh; VS Code continuous testing and save-triggered runs.
- **Execution and diagnostics:** Project diagnosis, local and Docker execution, custom remote commands and report transfer, and an opt-in parallel profile for supported Pest and ParaTest projects.
- **Results and insights:** JUnit result mapping, Clover statement and declaration coverage where reported, bounded workspace-local history, slow-test and flaky-candidate views, and searchable insight pickers.
- **AI-assisted authoring:** Detect only Codex CLI, GitHub Copilot CLI, and Claude Code. Generate PHPUnit or Pest tests from selected PHP, ask before sharing project context, preview a diff, and require explicit confirmation before saving under `tests/`.
- **Quality and performance:** Focused modules and tests for discovery, invocation, result mapping, report transfer, history, test-item identity, and coverage; isolated PHPUnit/Pest compatibility jobs across their supported PHP versions; VS Code extension-host coverage for the minimum supported and stable versions; scale benchmarks for discovery, mapping, and history.

## Prioritized roadmap

### P1 — Reduce orchestration complexity

**Status: In progress**

- Continue splitting discovery and result mapping out of extension orchestration where a clear ownership boundary exists.
- Keep filesystem, process, and VS Code API effects at module edges; expose deterministic helpers for parsing and mapping behavior.
- Add characterization tests before moving behavior, preserving stable test identities, cancellation, workspace ownership, and report fallback behavior.

**Done when:** extracted modules have focused interfaces and tests, extension orchestration is smaller, and existing discovery and result-mapping behavior remains unchanged.

### P2 — Keep performance evidence useful

**Status: Ongoing**

- Maintain the discovery, result-index, and run-history benchmarks with representative 1k/10k workloads and larger history cases.
- Assert result counts in every benchmark; compare measurements before optimizing and avoid machine-dependent CI thresholds.
- Investigate only repeatable regressions, and retain an optimization only when it improves measured workloads without changing results.

**Done when:** benchmark output remains reproducible enough to compare revisions, and each performance change includes before/after evidence and correctness coverage.

### P3 — Strengthen compatibility and test confidence

**Status: Ongoing**

- Keep the Node, VS Code, PHPUnit, and Pest CI matrices aligned with the declared support range.
- Add integration fixtures for compatibility failures that cannot be represented by unit tests, especially runtime listing, remote report retrieval, parallel scope, and cancellation.
- Add adversarial tests around malformed reports, duplicate identities, missing paths, interrupted processes, and unsupported runner versions.

**Done when:** supported combinations pass compile, unit, extension-host, package, and dependency-audit checks, and important fallback paths have regression coverage.

### P4 — Preserve trustworthy result details

**Status: Partial; broader coverage still needed**

- [PHPUnit 13.4's coverage manual](https://docs.phpunit.de/en/13.4/code-coverage.html) documents `--coverage-jsonl` and a `tests.jsonl` report that maps exact test identifiers to executed source-line ranges; the [12.5 manual](https://docs.phpunit.de/en/12.5/code-coverage.html) does not. A parser and schema-validation tests are in place.
- Local per-test details are now available for stable PHPUnit 13.4+ when the locked Composer version and shared local PHPUnit executable are known. Only unique class/method identities are mapped; data sets, Docker/custom commands, and remote report retrieval remain unsupported.
- Extend identity mapping and remote retrieval only when those paths can preserve exact test IDs and source paths.
- Keep Clover as the aggregate fallback for older PHPUnit versions and runners without test-level identity; never infer per-test coverage from aggregate counts.

**Done when:** all supported local and remote cases either map exact test-level details or clearly retain aggregate/unavailable behavior without guessing.

## Interfaces and acceptance criteria

- Missing reports, failed transfers, and zero-test executions are never presented as verified passes.
- Runtime discovery falls back to static discovery when unsupported or unsuccessful; refresh preserves unchanged test identities.
- Parallel execution remains opt-in, preserves requested scope, and can be cancelled.
- History is local to VS Code workspace state and bounded to the latest 100 runs per workspace. Slow and flaky summaries use completed, reported outcomes only.
- AI test generation detects only Codex CLI, GitHub Copilot CLI, and Claude Code; it is user-initiated, asks before sending context, previews output, and only writes a PHP test file under the workspace `tests/` directory after explicit confirmation.
- Coverage fields unsupported by the configured driver remain unavailable rather than inferred.

## Validation and delivery

- Run unit tests and compilation for code changes; add integration coverage when behavior crosses the VS Code, process, runner, or report boundary.
- Run relevant scale benchmarks for performance changes and compare against a baseline without hard-coded timing gates.
- Before each commit, run tests. After each commit, build and install the extension locally, then push completed commits using the established repository workflow.

## Research references

- [PHPUnit CLI](https://docs.phpunit.de/en/12.5/cli-options.html)
- [VS Code Testing API](https://code.visualstudio.com/api/extension-guides/testing)
- [Pest optimization](https://pestphp.com/docs/optimizing-tests)
- [ParaTest](https://github.com/paratestphp/paratest)
- [PHPUnit Test Workbench](https://marketplace.visualstudio.com/items?itemName=chiefmyron.phpunit-test-workbench)
- [PHP Tools](https://open-vsx.org/extension/DEVSENSE/phptools-vscode)

## Assumptions

- Framework scope is PHPUnit and Pest; adding other PHP test frameworks is out of scope.
- Parallel execution remains opt-in because tests can share mutable services or databases.
- Persistent history remains private to local VS Code workspace state and is not written to project files or sent externally.
