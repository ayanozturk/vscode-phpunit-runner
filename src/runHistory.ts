/** Maximum number of completed test runs retained for one workspace. */
export const MAX_RUN_HISTORY = 100;

/** Number of recent completed outcomes used to identify a flaky candidate. */
export const FLAKY_OUTCOME_WINDOW = 10;

export type RunCaseOutcome = 'passed' | 'failed' | 'skipped' | 'errored' | 'cancelled';

/** Raw case data from a VS Code run and its PHPUnit/Pest result report. */
export type RunHistoryCaseInput = {
  /** Stable test identity, such as the VS Code TestItem id. */
  testId: string;
  label: string;
  outcome: RunCaseOutcome;
  durationMs?: number;
  /** False when VS Code cancelled or failed to start this case. */
  completed: boolean;
  /** True only when the outcome came from a parsed test result report. */
  reported: boolean;
};

export type RunHistoryCase = {
  testId: string;
  label: string;
  outcome: RunCaseOutcome;
  durationMs?: number;
};

export type RunHistoryRunInput = {
  id: string;
  completedAt: string;
  cases: readonly RunHistoryCaseInput[];
};

export type RunHistoryRun = {
  id: string;
  completedAt: string;
  cases: RunHistoryCase[];
};

export type SlowTestOccurrence = {
  testId: string;
  label: string;
  outcome: RunCaseOutcome;
  durationMs: number;
  runId: string;
  completedAt: string;
};

export type FlakyCandidate = {
  testId: string;
  label: string;
  /** Recent pass/fail outcomes, newest first, at most FLAKY_OUTCOME_WINDOW entries. */
  recentOutcomes: Array<{ outcome: 'passed' | 'failed'; runId: string; completedAt: string }>;
};

/**
 * Converts a run into persisted history data, dropping cases that were not both
 * completed and confirmed by a parsed result report.
 */
export function createRunHistoryRecord(run: RunHistoryRunInput): RunHistoryRun {
  const cases = run.cases
    .filter((testCase) => testCase.completed && testCase.reported && testCase.testId.trim().length > 0)
    .map((testCase): RunHistoryCase => ({
      testId: testCase.testId,
      label: testCase.label,
      outcome: testCase.outcome,
      ...(isValidDuration(testCase.durationMs) ? { durationMs: testCase.durationMs } : {}),
    }));

  return { id: run.id, completedAt: run.completedAt, cases };
}

/** Appends one completed run and retains only the newest MAX_RUN_HISTORY records. */
export function appendRunHistory(
  history: readonly RunHistoryRun[],
  run: RunHistoryRunInput,
): RunHistoryRun[] {
  return [...history, createRunHistoryRecord(run)].slice(-MAX_RUN_HISTORY);
}

/** Returns reported completed case occurrences with the greatest durations first. */
export function getSlowestTests(
  history: readonly RunHistoryRun[],
  limit = 10,
): SlowTestOccurrence[] {
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  return history
    .flatMap((run) => run.cases.flatMap((testCase) => (
      isValidDuration(testCase.durationMs)
        ? [{
          testId: testCase.testId,
          label: testCase.label,
          outcome: testCase.outcome,
          durationMs: testCase.durationMs,
          runId: run.id,
          completedAt: run.completedAt,
        }]
        : []
    )))
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, Math.floor(limit));
}

/**
 * Finds tests with both passed and failed reported outcomes in their latest ten
 * pass/fail results. Skipped, errored, and cancelled outcomes do not affect the
 * classification or consume a slot in the window.
 */
export function findFlakyCandidates(history: readonly RunHistoryRun[]): FlakyCandidate[] {
  const byTest = new Map<string, FlakyCandidate['recentOutcomes']>();
  const labels = new Map<string, string>();
  const newestFirst = history
    .map((run, index) => ({ run, index, time: Date.parse(run.completedAt) }))
    .sort((left, right) => {
      const validTimeOrder = Number.isFinite(left.time) && Number.isFinite(right.time)
        ? right.time - left.time
        : 0;
      return validTimeOrder || right.index - left.index;
    });

  for (const { run } of newestFirst) {
    for (const testCase of run.cases) {
      if (testCase.outcome !== 'passed' && testCase.outcome !== 'failed') {
        continue;
      }
      const outcomes = byTest.get(testCase.testId) ?? [];
      if (outcomes.length >= FLAKY_OUTCOME_WINDOW) {
        continue;
      }
      outcomes.push({ outcome: testCase.outcome, runId: run.id, completedAt: run.completedAt });
      byTest.set(testCase.testId, outcomes);
      labels.set(testCase.testId, testCase.label);
    }
  }

  return [...byTest.entries()]
    .filter(([, outcomes]) => (
      outcomes.some((entry) => entry.outcome === 'passed')
      && outcomes.some((entry) => entry.outcome === 'failed')
    ))
    .map(([testId, recentOutcomes]) => ({ testId, label: labels.get(testId) ?? testId, recentOutcomes }));
}

function isValidDuration(durationMs: number | undefined): durationMs is number {
  return durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0;
}
