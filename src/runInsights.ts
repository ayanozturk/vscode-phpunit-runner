import { findFlakyCandidates, getSlowestTests, type RunHistoryRun } from './runHistory';

export type TestInsightChoice = {
  id: string;
  label: string;
  description: string;
  detail: string;
  filePath?: string;
  line?: number;
};

/** Builds navigable choices for the recent performance and reliability insights. */
export function createTestInsightChoices(
  history: readonly RunHistoryRun[],
  workspaceName: string,
  slowestLimit = 10,
): TestInsightChoice[] {
  const slowest = getSlowestTests(history, slowestLimit).map((test): TestInsightChoice => ({
    id: `slow:${test.testId}`,
    label: test.label,
    description: `${workspaceName} · ${test.durationMs.toFixed(0)} ms · ${test.outcome}`,
    detail: 'Slowest test in its latest reported run. Select to open its source file.',
    ...(test.filePath ? { filePath: test.filePath } : {}),
    ...(test.line ? { line: test.line } : {}),
  }));

  const flaky = findFlakyCandidates(history).map((test): TestInsightChoice => {
    const passes = test.recentOutcomes.filter(({ outcome }) => outcome === 'passed').length;
    const failures = test.recentOutcomes.length - passes;
    return {
      id: `flaky:${test.testId}`,
      label: test.label,
      description: `${workspaceName} · possible flaky · ${passes} passed, ${failures} failed`,
      detail: 'Both pass and fail outcomes appeared within the latest 10 reported runs. Select to open its source file.',
      ...(test.filePath ? { filePath: test.filePath } : {}),
      ...(test.line ? { line: test.line } : {}),
    };
  });

  return [...slowest, ...flaky];
}
