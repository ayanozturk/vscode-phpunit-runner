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
    label: `Slow: ${test.label}`,
    description: `${workspaceName} · ${test.durationMs.toFixed(0)} ms · ${test.outcome}`,
    detail: sourceDetail(
      'Slowest test in its latest reported run.',
      test.filePath,
      test.line,
    ),
    ...(test.filePath ? { filePath: test.filePath } : {}),
    ...(test.line ? { line: test.line } : {}),
  }));

  const flaky = findFlakyCandidates(history).map((test): TestInsightChoice => {
    const passes = test.recentOutcomes.filter(({ outcome }) => outcome === 'passed').length;
    const failures = test.recentOutcomes.length - passes;
    return {
      id: `flaky:${test.testId}`,
      label: `Flaky: ${test.label}`,
      description: `${workspaceName} · ${passes} passed, ${failures} failed`,
      detail: sourceDetail(
        'Both pass and fail outcomes appeared within the latest 10 reported runs.',
        test.filePath,
        test.line,
      ),
      ...(test.filePath ? { filePath: test.filePath } : {}),
      ...(test.line ? { line: test.line } : {}),
    };
  });

  return [...slowest, ...flaky];
}

function sourceDetail(summary: string, filePath?: string, line?: number): string {
  if (!filePath) {
    return `${summary} Source location was not included in the test report.`;
  }

  const segments = filePath.split(/[\\/]/).filter(Boolean);
  const shortPath = segments.slice(-2).join('/');
  const location = line ? `${shortPath}:${line}` : shortPath;
  return `${summary} Select to open ${location}.`;
}
