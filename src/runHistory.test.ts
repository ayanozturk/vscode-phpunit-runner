import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendRunHistory,
  createRunHistoryRecord,
  findFlakyCandidates,
  historyClearConfirmationMessage,
  getSlowestTests,
  MAX_RUN_HISTORY,
  type RunHistoryRun,
} from './runHistory';

function run(id: string, outcomes: Array<{
  testId: string;
  label?: string;
  outcome: 'passed' | 'failed' | 'skipped' | 'errored' | 'cancelled';
  durationMs?: number;
}>): RunHistoryRun {
  return {
    id,
    completedAt: `2026-01-${id.padStart(2, '0')}T00:00:00.000Z`,
    cases: outcomes.map((testCase) => ({
      testId: testCase.testId,
      label: testCase.label ?? testCase.testId,
      outcome: testCase.outcome,
      ...(testCase.durationMs === undefined ? {} : { durationMs: testCase.durationMs }),
    })),
  };
}

describe('run history', () => {
  it('describes the scope when confirming a history clear', () => {
    assert.equal(historyClearConfirmationMessage(1), 'Clear test insight history for 1 workspace?');
    assert.equal(historyClearConfirmationMessage(3), 'Clear test insight history for 3 workspaces?');
  });

  it('persists only completed cases confirmed by a result report', () => {
    const record = createRunHistoryRecord({
      id: 'run-1',
      completedAt: '2026-01-01T00:00:00.000Z',
      cases: [
        { testId: 'passed-test', label: 'passed', outcome: 'passed', durationMs: 20, completed: true, reported: true },
        { testId: 'cancelled-test', label: 'cancelled', outcome: 'cancelled', completed: false, reported: false },
        { testId: 'unverified-test', label: 'unverified', outcome: 'passed', completed: true, reported: false },
        { testId: 'not-started-test', label: 'not started', outcome: 'skipped', completed: false, reported: true },
        { testId: '   ', label: 'invalid', outcome: 'passed', completed: true, reported: true },
      ],
    });

    assert.deepEqual(record.cases, [{
      testId: 'passed-test', label: 'passed', outcome: 'passed', durationMs: 20,
    }]);
  });

  it('stores only a short normalized first-line summary for failed and errored cases', () => {
    const record = createRunHistoryRecord({
      id: 'run-errors',
      completedAt: '2026-01-01T00:00:00.000Z',
      cases: [
        {
          testId: 'failed', label: 'failed', outcome: 'failed',
          failureMessage: '\u001b[31mExpected 2, got 1\u001b[0m\nStack trace omitted', completed: true, reported: true,
        },
        {
          testId: 'errored', label: 'errored', outcome: 'errored',
          failureMessage: '  ' + 'x'.repeat(250), completed: true, reported: true,
        },
        {
          testId: 'passed', label: 'passed', outcome: 'passed',
          failureMessage: 'ignored', completed: true, reported: true,
        },
      ],
    });

    assert.deepEqual(record.cases.map(({ failureMessage }) => failureMessage), [
      'Expected 2, got 1',
      `${'x'.repeat(199)}…`,
      undefined,
    ]);
  });

  it('caps history at the newest 100 records', () => {
    const history = Array.from({ length: MAX_RUN_HISTORY + 5 }, (_, index) => run(String(index + 1), []));
    const result = appendRunHistory(history, {
      id: 'latest',
      completedAt: '2026-02-01T00:00:00.000Z',
      cases: [],
    });

    assert.equal(result.length, MAX_RUN_HISTORY);
    assert.equal(result[0].id, '7');
    assert.equal(result.at(-1)?.id, 'latest');
    assert.equal(history.length, MAX_RUN_HISTORY + 5, 'the input history is not mutated');
  });

  it('ranks valid durations from completed reported cases and ignores invalid timings', () => {
    const history = [run('1', [
      { testId: 'slow', outcome: 'failed', durationMs: 1200 },
      { testId: 'fast', outcome: 'passed', durationMs: 10 },
      { testId: 'no-time', outcome: 'passed' },
    ])];
    history[0].cases.push(
      { testId: 'negative', label: 'negative', outcome: 'passed', durationMs: -1 },
      { testId: 'infinite', label: 'infinite', outcome: 'passed', durationMs: Number.POSITIVE_INFINITY },
    );

    assert.deepEqual(getSlowestTests(history), [
      { testId: 'slow', label: 'slow', outcome: 'failed', durationMs: 1200, runId: '1', completedAt: history[0].completedAt },
      { testId: 'fast', label: 'fast', outcome: 'passed', durationMs: 10, runId: '1', completedAt: history[0].completedAt },
    ]);
    assert.deepEqual(getSlowestTests(history, 0), []);
  });

  it('uses each test’s latest duration so repeated runs do not crowd out unique slow tests', () => {
    const history = [
      {
        ...run('old', [{ testId: 'repeated', outcome: 'passed', durationMs: 1500 }]),
        completedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        ...run('latest', [{ testId: 'repeated', outcome: 'passed', durationMs: 400 }]),
        completedAt: '2026-01-03T00:00:00.000Z',
      },
      {
        ...run('other', [{ testId: 'other', outcome: 'passed', durationMs: 900 }]),
        completedAt: '2026-01-02T00:00:00.000Z',
      },
    ];

    assert.deepEqual(getSlowestTests(history).map(({ testId, durationMs, runId }) => ({ testId, durationMs, runId })), [
      { testId: 'other', durationMs: 900, runId: 'other' },
      { testId: 'repeated', durationMs: 400, runId: 'latest' },
    ]);
  });

  it('uses later history order to break equal completion-time ties', () => {
    const history = [
      { ...run('first', [{ testId: 'same-time', outcome: 'passed', durationMs: 100 }]), completedAt: '2026-01-01T00:00:00.000Z' },
      { ...run('second', [{ testId: 'same-time', outcome: 'passed', durationMs: 200 }]), completedAt: '2026-01-01T00:00:00.000Z' },
    ];

    assert.deepEqual(getSlowestTests(history).map(({ runId, durationMs }) => ({ runId, durationMs })), [
      { runId: 'second', durationMs: 200 },
    ]);
  });

  it('uses valid completion timestamps when history records are out of order', () => {
    const history = [
      { ...run('newer', [{ testId: 'out-of-order', outcome: 'passed', durationMs: 300 }]), completedAt: '2026-01-03T00:00:00.000Z' },
      { ...run('older', [{ testId: 'out-of-order', outcome: 'passed', durationMs: 100 }]), completedAt: '2026-01-02T00:00:00.000Z' },
    ];

    assert.deepEqual(getSlowestTests(history).map(({ runId, durationMs }) => ({ runId, durationMs })), [
      { runId: 'newer', durationMs: 300 },
    ]);
  });

  it('uses history order when either completion timestamp is invalid', () => {
    const history = [
      { ...run('valid', [{ testId: 'invalid-time', outcome: 'passed', durationMs: 100 }]), completedAt: '2026-01-01T00:00:00.000Z' },
      { ...run('invalid', [{ testId: 'invalid-time', outcome: 'passed', durationMs: 200 }]), completedAt: 'not-a-timestamp' },
    ];

    assert.deepEqual(getSlowestTests(history).map(({ runId, durationMs }) => ({ runId, durationMs })), [
      { runId: 'invalid', durationMs: 200 },
    ]);
  });

  it('flags a candidate only when both pass and fail appear in the latest ten outcomes', () => {
    const history = [
      run('1', [{ testId: 'flaky', outcome: 'failed' }, { testId: 'stable', outcome: 'failed' }]),
      ...Array.from({ length: 9 }, (_, index) => run(String(index + 2), [
        { testId: 'flaky', outcome: 'passed' },
        { testId: 'stable', outcome: 'failed' },
      ])),
      run('11', [{ testId: 'flaky', outcome: 'passed' }, { testId: 'stable', outcome: 'passed' }]),
    ];

    const candidates = findFlakyCandidates(history);
    assert.deepEqual(candidates, [{
      testId: 'stable',
      label: 'stable',
      recentOutcomes: Array.from({ length: 10 }, (_, index) => ({
        outcome: (index === 0 ? 'passed' : 'failed') as 'passed' | 'failed',
        runId: String(11 - index),
        completedAt: `2026-01-${String(11 - index).padStart(2, '0')}T00:00:00.000Z`,
      })),
    }]);
  });

  it('ignores non pass/fail outcomes when building the recent flakiness window', () => {
    const history = [
      run('1', [{ testId: 'test', outcome: 'failed' }]),
      ...Array.from({ length: 10 }, (_, index) => run(String(index + 2), [
        { testId: 'test', outcome: index === 9 ? 'passed' : 'skipped' },
      ])),
    ];

    assert.equal(findFlakyCandidates(history).length, 1);
  });

  it('uses only each test’s latest ten pass/fail results', () => {
    const history = [
      run('1', [{ testId: 'test', outcome: 'failed' }]),
      ...Array.from({ length: 10 }, (_, index) => run(String(index + 2), [
        { testId: 'test', outcome: 'passed' },
      ])),
    ];

    assert.deepEqual(findFlakyCandidates(history), []);
  });

  it('does not infer flakiness from conflicting duplicate outcomes within one run', () => {
    const history = [run('1', [
      { testId: 'duplicate', outcome: 'passed' },
      { testId: 'duplicate', outcome: 'failed' },
    ])];

    assert.deepEqual(findFlakyCandidates(history), []);
  });

  it('counts repeated same-outcome records once per run', () => {
    const history = [
      run('1', [
        { testId: 'duplicate', outcome: 'failed' },
        { testId: 'duplicate', outcome: 'failed' },
      ]),
      run('2', [{ testId: 'duplicate', outcome: 'passed' }]),
    ];

    assert.deepEqual(findFlakyCandidates(history), [{
      testId: 'duplicate',
      label: 'duplicate',
      recentOutcomes: [
        { outcome: 'passed', runId: '2', completedAt: '2026-01-02T00:00:00.000Z' },
        { outcome: 'failed', runId: '1', completedAt: '2026-01-01T00:00:00.000Z' },
      ],
    }]);
  });
});
