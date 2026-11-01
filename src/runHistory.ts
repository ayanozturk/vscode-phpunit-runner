/** Maximum number of completed test runs retained for one workspace. */
export const MAX_RUN_HISTORY = 100;

/** Number of recent completed outcomes used to identify a flaky candidate. */
export const FLAKY_OUTCOME_WINDOW = 10;

/** Creates the confirmation prompt for clearing local history across workspaces. */
export function historyClearConfirmationMessage(workspaceCount: number): string {
  const count = Math.max(0, Math.floor(workspaceCount));
  return `Clear test insight history for ${count} workspace${count === 1 ? '' : 's'}?`;
}

export type RunCaseOutcome = 'passed' | 'failed' | 'skipped' | 'errored' | 'cancelled';

/** Raw case data from a VS Code run and its PHPUnit/Pest result report. */
export type RunHistoryCaseInput = {
  /** Stable test identity, such as the VS Code TestItem id. */
  testId: string;
  label: string;
  outcome: RunCaseOutcome;
  durationMs?: number;
  filePath?: string;
  line?: number;
  /** Optional concise failure summary; callers should omit stack traces. */
  failureMessage?: string;
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
  filePath?: string;
  line?: number;
  failureMessage?: string;
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
  filePath?: string;
  line?: number;
};

export type FlakyCandidate = {
  testId: string;
  label: string;
  filePath?: string;
  line?: number;
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
      ...(testCase.filePath?.trim() ? { filePath: testCase.filePath.trim() } : {}),
      ...(isValidLine(testCase.line) ? { line: testCase.line } : {}),
      ...((testCase.outcome === 'failed' || testCase.outcome === 'errored')
        && testCase.failureMessage?.trim()
        ? { failureMessage: normalizeFailureMessage(testCase.failureMessage) }
        : {}),
    }));

  return { id: run.id, completedAt: run.completedAt, cases };
}

function normalizeFailureMessage(message: string): string {
  const firstLine = message.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const normalized = firstLine
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 200 ? `${normalized.slice(0, 199).trimEnd()}…` : normalized;
}

/** Appends one completed run and retains only the newest MAX_RUN_HISTORY records. */
export function appendRunHistory(
  history: readonly RunHistoryRun[],
  run: RunHistoryRunInput,
): RunHistoryRun[] {
  return [...history, createRunHistoryRecord(run)].slice(-MAX_RUN_HISTORY);
}

/**
 * Returns one latest reported occurrence per test, ranked by its latest
 * duration. A repeated test therefore cannot take multiple slots.
 */
export function getSlowestTests(
  history: readonly RunHistoryRun[],
  limit = 10,
): SlowTestOccurrence[] {
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  const latestByTest = new Map<string, {
    testCase: RunHistoryCase;
    run: RunHistoryRun;
    durationMs: number;
    historyIndex: number;
    timestamp: number;
  }>();
  history.forEach((run, historyIndex) => {
    const timestamp = Date.parse(run.completedAt);
    for (const testCase of run.cases) {
      if (!isValidDuration(testCase.durationMs)) {
        continue;
      }

      const previous = latestByTest.get(testCase.testId);
      const previousHasTimestamp = previous !== undefined && Number.isFinite(previous.timestamp);
      const currentHasTimestamp = Number.isFinite(timestamp);
      let isNewer = previous === undefined;
      if (previous) {
        if (currentHasTimestamp && previousHasTimestamp) {
          isNewer = timestamp > previous.timestamp
            || (timestamp === previous.timestamp && historyIndex > previous.historyIndex);
        } else {
          isNewer = historyIndex > previous.historyIndex;
        }
      }

      if (isNewer) {
        // Retain the source record and construct the public occurrence only
        // after scanning history. Most cases are older repeats, so this avoids
        // allocating an output object for every stored result.
        latestByTest.set(testCase.testId, { testCase, run, durationMs: testCase.durationMs, historyIndex, timestamp });
      }
    }
  });

  return [...latestByTest.values()]
    .map(({ testCase, run, durationMs }): SlowTestOccurrence => ({
      testId: testCase.testId,
      label: testCase.label,
      outcome: testCase.outcome,
      durationMs,
      runId: run.id,
      completedAt: run.completedAt,
      ...(testCase.filePath ? { filePath: testCase.filePath } : {}),
      ...(isValidLine(testCase.line) ? { line: testCase.line } : {}),
    }))
    .sort((left, right) => (
      right.durationMs - left.durationMs
      || right.completedAt.localeCompare(left.completedAt)
      || left.testId.localeCompare(right.testId)
    ))
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
  const locations = new Map<string, { filePath?: string; line?: number }>();
  const newestFirst = history
    .map((run, index) => ({ run, index, time: Date.parse(run.completedAt) }))
    .sort((left, right) => {
      const validTimeOrder = Number.isFinite(left.time) && Number.isFinite(right.time)
        ? right.time - left.time
        : 0;
      return validTimeOrder || right.index - left.index;
    });

  for (const { run } of newestFirst) {
    const outcomesInRun = new Map<string, { testCase: RunHistoryCase; outcome: 'passed' | 'failed'; conflicting: boolean }>();
    for (const testCase of run.cases) {
      if (testCase.outcome !== 'passed' && testCase.outcome !== 'failed') {
        continue;
      }
      if ((byTest.get(testCase.testId)?.length ?? 0) >= FLAKY_OUTCOME_WINDOW) {
        continue;
      }
      const existing = outcomesInRun.get(testCase.testId);
      if (existing) {
        if (existing.outcome !== testCase.outcome) {
          existing.conflicting = true;
        }
        continue;
      }
      outcomesInRun.set(testCase.testId, {
        testCase,
        outcome: testCase.outcome,
        conflicting: false,
      });
    }

    for (const [testId, runOutcome] of outcomesInRun) {
      // Conflicting duplicate records in one run cannot establish flakiness.
      if (runOutcome.conflicting) {
        continue;
      }
      const outcomes = byTest.get(testId) ?? [];
      if (outcomes.length >= FLAKY_OUTCOME_WINDOW) {
        continue;
      }
      outcomes.push({ outcome: runOutcome.outcome, runId: run.id, completedAt: run.completedAt });
      byTest.set(testId, outcomes);
      if (!labels.has(testId)) {
        labels.set(testId, runOutcome.testCase.label);
        locations.set(testId, {
          ...(runOutcome.testCase.filePath ? { filePath: runOutcome.testCase.filePath } : {}),
          ...(isValidLine(runOutcome.testCase.line) ? { line: runOutcome.testCase.line } : {}),
        });
      }
    }
  }

  return [...byTest.entries()]
    .filter(([, outcomes]) => (
      outcomes.some((entry) => entry.outcome === 'passed')
      && outcomes.some((entry) => entry.outcome === 'failed')
    ))
    .map(([testId, recentOutcomes]) => ({
      testId,
      label: labels.get(testId) ?? testId,
      ...locations.get(testId),
      recentOutcomes,
    }));
}

function isValidDuration(durationMs: number | undefined): durationMs is number {
  return durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0;
}

function isValidLine(line: number | undefined): line is number {
  return line !== undefined && Number.isInteger(line) && line > 0;
}
