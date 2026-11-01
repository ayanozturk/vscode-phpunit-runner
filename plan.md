# PHPUnit Runner Roadmap

## Goal

Make PHPUnit Runner a fast, dependable PHPUnit and Pest workflow in VS Code, from initial discovery through local, containerized, and remote execution. This roadmap targets the next 6–12 months and prioritizes trustworthy results, low-latency feedback, and practical diagnostics before adding more surface area.

Research confirms that machine-readable test listing and result formats are available in PHPUnit, VS Code supports native continuous runs and detailed coverage, and Pest and ParaTest provide parallel execution. PHP testing tools also surface run history, timings, and profiling. ([PHPUnit CLI](https://docs.phpunit.de/en/12.5/cli-options.html), [VS Code Testing API](https://code.visualstudio.com/api/extension-guides/testing), [Pest optimization](https://pestphp.com/docs/optimizing-tests), [ParaTest](https://github.com/paratestphp/paratest), [PHPUnit Test Workbench](https://marketplace.visualstudio.com/items?itemName=chiefmyron.phpunit-test-workbench), [PHP Tools](https://open-vsx.org/extension/DEVSENSE/phptools-vscode))

## Progress

- **Delivered:** Dynamic PHPUnit provider listing with static fallback, project diagnostics, remote report transfer, incremental discovery, VS Code native continuous runs, saved-file continuous runs, and workspace-local history/slow-test/flaky-candidate insights.
- **Delivered:** Test insight choices can open the latest reported source location. Clover coverage now includes named method declarations, available method totals, and per-test detail for a single selected method or data set while preserving statement coverage.
- **Delivered:** An opt-in Parallel Tests profile for detected Pest and ParaTest installations, with configurable workers, scoped execution, JUnit mapping, and cancellation; unsupported Artisan and opaque remote commands are reported clearly.
- **Delivered:** Node 22/24 quality and PHPUnit 10–13/Pest 3–5 CLI compatibility GitHub Actions matrices, plus focused modules for run history and excluded test scopes. Compatibility fixtures exercise PHPUnit runtime listing, JUnit output, and Pest parallel runs. Result mapping avoids intermediate nested-array allocations in its lookup paths.
- **Baselines added:** `npm run benchmark:discovery` and `npm run benchmark:result-index` measure synthetic 1k/10k test workloads without machine-dependent thresholds. On this local machine, initial discovery medians were about 19/180 ms; result mapping improved from 5.8 to 3.9 ms for 10k method lookups and 258 to 221 ms for Pest lookups.
- **Performance note:** A measured alternative to the parser's comment/string masking was slower on both benchmark sizes, so it was discarded without changing parser behavior.
- **Delivered:** Process creation, output capture, cancellation, and exit handling for test and remote-transfer commands now share a tested process runner. Remote report template variables are substituted in one pass so placeholder-like text inside a path remains literal.
- **Delivered:** Result mapping now treats PHP class and method names case-insensitively while preserving data-set label matching. Composer-driven runtime discovery now ignores stale cancelled runs, preventing them from suppressing the latest refresh. The benchmark exercises the bounded trigram fallback used for JUnit cases without file metadata.
- **Delivered:** Runtime provider results preserve source method casing, repeated include globs run once per refresh, and plain-output mode strips ANSI colors from failure messages. JUnit path remapping now lives in a focused module with tests for sibling-path boundaries and Windows separators.
- **Delivered:** Remote invocation maps absolute PHP runtime-argument paths, and test insight choices identify their category in the label. Users can clear locally stored insight history for the active workspace from the Command Palette.
- **Delivered:** Project Diagnosis command lookup now lives in a focused module and checks bounded PATH batches; coverage recognizes Clover return-by-reference method signatures, and Windows runner detection consistently prefers the declared Pest shim over ParaTest.
- **Benchmark quality:** Result-index lookup inputs are prepared outside timed loops, and benchmark runs assert expected match counts so missing results cannot appear as faster timings. A measured optimization attempt showed no meaningful result-index speedup and was reverted.
- **Performance:** Attribute-alias scanning now limits indentation whitespace to one line instead of rescanning across masked heredocs. On a 5,000-line heredoc fixture this dropped from 11.1 seconds to 16.9 ms; the normal 1k/10k discovery benchmark remained effectively flat. The large-heredoc scenario is now part of that benchmark.
- **Measured:** On this local machine, trigram fallback across 10k JUnit cases took about 69 ms to index and 351 ms for 10k lookups; the fallback is now represented in the benchmark for future comparisons.
- **Still planned:** Further module boundaries around invocation and result mapping, plus coverage attribution for multi-test runs if the report format can support it safely.

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
- Extend coverage details to declarations and individual tests when supported by the runner and coverage driver; keep current statement coverage as the fallback. Named declarations and single-test attribution are delivered; merged reports still do not provide reliable test-to-declaration attribution.

### 4. Compatibility and maintainability — months 8–12

- Keep the CI compatibility matrix current as supported PHPUnit and Pest releases change; automate compile, unit, extension integration, packaging, and dependency-audit checks.
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
