import { findFlakyCandidates, getSlowestTests, type RunHistoryRun } from './runHistory';

export type TestInsightChoice = {
  id: string;
  label: string;
  description: string;
  detail: string;
  filePath?: string;
  line?: number;
};

/** A report location is runnable when it can be mapped to a source range. */
export function canRunTestInsight(choice: TestInsightChoice): boolean {
  return Boolean(choice.filePath?.trim())
    && choice.line !== undefined
    && Number.isInteger(choice.line)
    && choice.line > 0;
}

/** Formats a complete insight summary for copying or sharing outside the picker. */
export function formatTestInsightForClipboard(choice: TestInsightChoice): string {
  const line = typeof choice.line === 'number' && Number.isInteger(choice.line) && choice.line > 0
    ? `:${choice.line}`
    : '';
  const location = choice.filePath
    ? `${choice.filePath}${line}`
    : 'Source location unavailable';
  return `${choice.label}\n${choice.description}\n${choice.detail}\nLocation: ${location}`;
}

/** Builds navigable choices for the recent performance and reliability insights. */
export function createTestInsightChoices(
  history: readonly RunHistoryRun[],
  workspaceName: string,
  slowestLimit = 10,
): TestInsightChoice[] {
  const slowest = getSlowestTests(history, slowestLimit).map((test): TestInsightChoice => ({
    id: `slow:${test.testId}`,
    label: `Slow: ${test.label}`,
    description: `${workspaceName} · ${test.durationMs.toFixed(0)} ms · ${test.outcome}${dateSuffix(test.completedAt)}`,
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
    const recentOutcomes = test.recentOutcomes
      .map(({ outcome }) => outcome === 'passed' ? 'passed' : 'failed')
      .join(' → ');
    const latestCompletedAt = test.recentOutcomes[0]?.completedAt;
    return {
      id: `flaky:${test.testId}`,
      label: `Flaky: ${test.label}`,
      description: `${workspaceName} · ${passes} passed, ${failures} failed${latestCompletedAt ? dateSuffix(latestCompletedAt, ' · latest ') : ''}`,
      detail: sourceDetail(
        `Recent outcomes, newest first: ${recentOutcomes}.`,
        test.filePath,
        test.line,
      ),
      ...(test.filePath ? { filePath: test.filePath } : {}),
      ...(test.line ? { line: test.line } : {}),
    };
  });

  return [...slowest, ...flaky];
}

function dateSuffix(completedAt: string, prefix = ' · '): string {
  const timestamp = Date.parse(completedAt);
  return Number.isFinite(timestamp) ? `${prefix}${new Date(timestamp).toISOString().slice(0, 10)}` : '';
}

function sourceDetail(summary: string, filePath?: string, line?: number): string {
  if (!filePath) {
    return `${summary} The report did not include a source file, so this test cannot be opened or run from the insight.`;
  }

  const segments = filePath.split(/[\\/]/).filter(Boolean);
  const shortPath = segments.slice(-2).join('/');
  if (!line) {
    return `${summary} Select to open ${shortPath}. The report did not include a line number, so this test cannot be run from the insight.`;
  }
  return `${summary} Select to open ${shortPath}:${line}.`;
}
