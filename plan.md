# PHPUnit Runner Roadmap

## Goal

Make PHPUnit Runner a fast, dependable PHPUnit and Pest workflow in VS Code, from initial discovery through local, containerized, and remote execution. This roadmap targets the next 6–12 months and prioritizes trustworthy results, low-latency feedback, and practical diagnostics before adding more surface area.

Research confirms that machine-readable test listing and result formats are available in PHPUnit, VS Code supports native continuous runs and detailed coverage, and Pest provides parallel execution and profiling. PHP testing tools also surface run history, timings, and profiling. ([PHPUnit CLI](https://docs.phpunit.de/en/12.5/cli-options.html), [VS Code Testing API](https://code.visualstudio.com/api/extension-guides/testing), [Pest optimization](https://pestphp.com/docs/optimizing-tests), [PHPUnit Test Workbench](https://marketplace.visualstudio.com/items?itemName=chiefmyron.phpunit-test-workbench), [PHP Tools](https://open-vsx.org/extension/DEVSENSE/phptools-vscode))

## Progress

- **Delivered:** Dynamic PHPUnit provider listing with static fallback, project diagnostics, remote report transfer, incremental discovery, VS Code native continuous runs, saved-file continuous runs, and workspace-local history/slow-test/flaky-candidate insights.
- **Baseline added:** `npm run benchmark:discovery` measures 1k and 10k synthetic test projects. Initial local median parser times were about 19 ms and 182 ms respectively; these observations do not impose machine-dependent pass/fail thresholds.
- **Still planned:** Opt-in parallel execution, richer coverage, a supported PHPUnit/Pest CI matrix, and further module boundaries around invocation and result mapping.

## Roadmap

### 1. Trustworthy discovery and results — months 0–2

- Keep static discovery responsive, then use version-supported PHPUnit runtime listing to discover dynamic providers and tests that cannot be resolved statically. Reconcile runtime and static results by stable file, class, method, and data-set identity; retain static fallback when runtime listing is unsupported.
- Add **PHPUnit Runner: Diagnose Project**. Report detected framework and version, effective configuration and working directory, resolved command, and result-report readiness without running the test suite. Explain missing reports and “no tests executed” as unverified outcomes with actionable next steps.
- Add optional `phpunitRunner.remote.reportTransferCommand` for custom remote execution. Provide remote and local JUnit/Clover path placeholders, run the transfer after test execution but before parsing reports, and surface transfer failures as unverified results. Keep shared/mounted reports as the zero-configuration path for Docker.

### 2. Faster discovery and continuous feedback — months 2–4

- Replace whole-tree resets with incremental updates that preserve test identities and last-known results for unchanged files. Cache parsed files and invalidate on PHP, Composer manifest/lock, PHPUnit configuration, or workspace changes.
- Support VS Code’s native continuous-testing controls while preserving the existing save-triggered setting.
- Establish repeatable discovery and result-mapping benchmarks at 1k and 10k test items. Optimize measured bottlenecks and track regressions without adding telemetry.

### 3. Parallel runs and useful test insights — months 4–8

- Add an opt-in **Parallel Tests** profile. Use one top-level runner invocation per selected scope and delegate to detected Pest or ParaTest support. Keep serial execution as the default; preserve filters, cancellation, result mapping, and debug behavior.
- Store bounded run history in VS Code workspace state only, capped at the latest 100 runs per workspace. Show slowest tests and flag a flaky candidate only when both pass and fail outcomes occur in the test’s last 10 completed runs. Do not automatically retry tests or change their reported outcomes.
- Extend coverage details to declarations and individual tests when supported by the runner and coverage driver; keep current statement coverage as the fallback.

### 4. Compatibility and maintainability — months 8–12

- Add a CI compatibility matrix for supported PHPUnit and Pest versions and automate compile, unit, extension integration, packaging, and dependency-audit checks.
- Split discovery, invocation/report transport, result mapping, and run insights into focused modules so independent changes remain easy to test and review.

## Interfaces and acceptance criteria

- Add the Diagnose Project command, optional remote report-transfer setting, and opt-in parallel profile/process-count setting. Parallel execution is off by default. Run history remains local to VS Code workspace state and is capped at 100 runs per workspace.
- Dynamic test cases are discoverable and individually runnable where runtime listing is supported; version or runner limitations fall back without blocking static discovery.
- Missing reports and zero-test results are never presented as verified passes. A successful remote transfer produces mapped test and coverage results; failed transfer explains why details are unavailable.
- Incremental refresh updates changed files without replacing unchanged test identities. Parallel runs preserve the requested scope and can be cancelled.
- Timing and flaky-candidate summaries use completed, reported test cases only. Coverage fields unsupported by a driver remain unavailable rather than inferred.

## Validation and delivery

- Test runtime-list parsing, version fallback, report-transfer quoting and failure, cache invalidation, stable identities, history/flakiness classification, parallel filtering and cancellation, and coverage fallbacks.
- Run extension integration tests against representative PHPUnit and Pest fixtures. Use scale benchmarks to guard discovery and mapping performance.
- Develop independent workstreams in parallel where possible, with a single integration pass over shared orchestration code. Run tests before every commit; build and install locally after every commit; push completed commits using the established repository workflow.

## Assumptions

- Audience: maintainers and future contributors. Framework scope: PHPUnit and Pest; adding other PHP test frameworks is out of scope for this roadmap.
- Remote result transfer is a core milestone. Parallel execution is opt-in because tests may share mutable services or databases.
- Persistent history is private to the local VS Code workspace state; it is not written into project files or sent to external services.
