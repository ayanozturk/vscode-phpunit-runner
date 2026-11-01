import { findFlakyCandidates, getSlowestTests, type RunHistoryRun } from './runHistory';
import { getLatestTestProblems, normalizeInsightLimit } from './runInsights';

export type InsightReportWorkspace = {
  name: string;
  history: readonly RunHistoryRun[];
  limit?: number;
};

/** Formats bounded, verified workspace history as a shareable Markdown report. */
export function formatTestInsightsReport(
  workspaces: readonly InsightReportWorkspace[],
  requestedLimit = 10,
): string {
  const sections = workspaces
    .filter(({ history }) => history.length > 0)
    .map(({ name, history, limit: workspaceLimit }) => {
      const limit = normalizeInsightLimit(workspaceLimit ?? requestedLimit);
      const slowest = getSlowestTests(history, limit);
      const flaky = findFlakyCandidates(history).slice(0, limit);
      const problems = getLatestTestProblems(history, limit);
      return [
        `## ${markdownText(name)}`,
        '',
        '### Slowest tests',
        ...slowest.map((test) => (
          `- ${markdownText(test.label)} — ${test.durationMs.toFixed(0)} ms (${test.outcome})${dateText(test.completedAt)}${locationText(test.filePath, test.line)}`
        )),
        ...emptyLineIfNone(slowest.length),
        '',
        '### Flaky candidates',
        ...flaky.map((test) => {
          const outcomes = test.recentOutcomes.map(({ outcome }) => outcome).join(' → ');
          const location = locationText(test.filePath, test.line);
          return `- ${markdownText(test.label)} — ${outcomes}${location}`;
        }),
        ...emptyLineIfNone(flaky.length),
        '',
        '### Latest failures and errors',
        ...problems.map((test) => (
          `- ${markdownText(test.label)} — ${test.outcome}${test.failureMessage ? `: ${markdownText(test.failureMessage)}` : ''}${locationText(test.filePath, test.line)}`
        )),
        ...emptyLineIfNone(problems.length),
      ].join('\n');
    });

  return sections.length > 0
    ? `# PHPUnit Test Insights\n\n${sections.join('\n\n')}`
    : '# PHPUnit Test Insights\n\nNo completed, reported test runs are available yet.';
}

function emptyLineIfNone(count: number): string[] {
  return count === 0 ? ['- None.'] : [];
}

function dateText(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? `, ${new Date(timestamp).toISOString().slice(0, 10)}` : '';
}

function locationText(filePath?: string, line?: number): string {
  if (!filePath) {
    return '';
  }
  const location = `${filePath}${Number.isInteger(line) && (line ?? 0) > 0 ? `:${line}` : ''}`;
  return ` — \`${location.replace(/`/g, '\\`')}\``;
}

function markdownText(value: string): string {
  return value.replace(/[\\`*_{}\[\]<>()#+.!|]/g, '\\$&').replace(/\s+/g, ' ').trim();
}
