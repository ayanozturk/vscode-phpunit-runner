import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canRunTestInsight,
  createTestInsightChoices,
  formatTestInsightForClipboard,
  getLatestTestProblems,
  normalizeInsightLimit,
} from './runInsights';
import type { RunHistoryRun } from './runHistory';

describe('createTestInsightChoices', () => {
  it('creates navigable slow and flaky choices with workspace and source context', () => {
    const history: RunHistoryRun[] = [
      {
        id: 'first',
        completedAt: '2026-01-01T00:00:00.000Z',
        cases: [{
          testId: 'workspace::ExampleTest::testFlaky',
          label: 'ExampleTest::testFlaky',
          outcome: 'failed',
          durationMs: 150,
          filePath: '/workspace/tests/ExampleTest.php',
          line: 18,
        }],
      },
      {
        id: 'second',
        completedAt: '2026-01-02T00:00:00.000Z',
        cases: [{
          testId: 'workspace::ExampleTest::testFlaky',
          label: 'ExampleTest::testFlaky',
          outcome: 'passed',
          durationMs: 120,
          filePath: '/workspace/tests/ExampleTest.php',
          line: 18,
        }],
      },
    ];

    assert.deepEqual(createTestInsightChoices(history, 'api'), [
      {
        id: 'slow:workspace::ExampleTest::testFlaky',
        testIdentity: 'workspace::ExampleTest::testFlaky',
        label: 'Slow: ExampleTest::testFlaky',
        description: 'api · 120 ms · passed · 2026-01-02',
        detail: 'Slowest test in its latest reported run. Select to open tests/ExampleTest.php:18.',
        filePath: '/workspace/tests/ExampleTest.php',
        line: 18,
      },
      {
        id: 'flaky:workspace::ExampleTest::testFlaky',
        testIdentity: 'workspace::ExampleTest::testFlaky',
        label: 'Flaky: ExampleTest::testFlaky',
        description: 'api · 1 passed, 1 failed · latest 2026-01-02',
        detail: 'Recent outcomes, newest first: passed → failed. Select to open tests/ExampleTest.php:18.',
        filePath: '/workspace/tests/ExampleTest.php',
        line: 18,
      },
    ]);
  });

  it('omits source location when the report does not provide one', () => {
    const history: RunHistoryRun[] = [{
      id: 'run',
      completedAt: '2026-01-01T00:00:00.000Z',
      cases: [{ testId: 'id', label: 'Test::method', outcome: 'passed', durationMs: 20 }],
    }];

    assert.equal(createTestInsightChoices(history, 'workspace')[0].filePath, undefined);
  });

  it('omits an invalid run date instead of presenting a misleading timestamp', () => {
    const history: RunHistoryRun[] = [{
      id: 'run',
      completedAt: 'not-a-date',
      cases: [{ testId: 'id', label: 'Test::method', outcome: 'passed', durationMs: 20 }],
    }];

    assert.equal(createTestInsightChoices(history, 'workspace')[0].description, 'workspace · 20 ms · passed');
  });

  it('explains when a report has no source file and the insight cannot be opened or run', () => {
    const history: RunHistoryRun[] = [{
      id: 'run',
      completedAt: '2026-01-01T00:00:00.000Z',
      cases: [{ testId: 'id', label: 'Test::method', outcome: 'passed', durationMs: 20 }],
    }];

    const [choice] = createTestInsightChoices(history, 'workspace');
    assert.match(choice.label, /^Slow:/);
    assert.match(choice.detail, /did not include a source file/);
    assert.match(choice.detail, /cannot be opened or run/);
    assert.doesNotMatch(choice.detail, /Select to open/);
  });

  it('explains that a report without a line number can open its source but cannot run the test', () => {
    const history: RunHistoryRun[] = [{
      id: 'run',
      completedAt: '2026-01-01T00:00:00.000Z',
      cases: [{
        testId: 'id',
        label: 'Test::method',
        outcome: 'passed',
        durationMs: 20,
        filePath: 'C:\\workspace\\tests\\ExampleTest.php',
      }],
    }];

    const [choice] = createTestInsightChoices(history, 'workspace');
    assert.match(choice.detail, /Select to open tests\/ExampleTest\.php/);
    assert.match(choice.detail, /did not include a line number/);
    assert.match(choice.detail, /cannot be run from the insight/);
    assert.equal(canRunTestInsight(choice), false);
    assert.doesNotMatch(choice.detail, /:0/);
  });
});

describe('canRunTestInsight', () => {
  it('requires a source file and positive integer line to map a test action', () => {
    assert.equal(canRunTestInsight({ id: 'slow:a', label: 'Slow', description: '', detail: '', filePath: '/tests/A.php', line: 12 }), true);
    assert.equal(canRunTestInsight({ id: 'slow:b', label: 'Slow', description: '', detail: '', filePath: '/tests/B.php' }), false);
    assert.equal(canRunTestInsight({ id: 'slow:c', label: 'Slow', description: '', detail: '', filePath: '/tests/C.php', line: 0 }), false);
    assert.equal(canRunTestInsight({ id: 'slow:d', label: 'Slow', description: '', detail: '', line: 12 }), false);
  });
});

describe('normalizeInsightLimit', () => {
  it('uses the default for missing or invalid values and clamps configured limits', () => {
    assert.equal(normalizeInsightLimit(undefined), 10);
    assert.equal(normalizeInsightLimit(Number.NaN), 10);
    assert.equal(normalizeInsightLimit(3.8), 3);
    assert.equal(normalizeInsightLimit(0), 1);
    assert.equal(normalizeInsightLimit(500), 100);
  });
});

describe('getLatestTestProblems', () => {
  it('lists only the latest failed or errored outcome per test and keeps its source location', () => {
    const history: RunHistoryRun[] = [
      {
        id: 'old',
        completedAt: '2026-01-01T00:00:00.000Z',
        cases: [
          { testId: 'recovered', label: 'Test::recovered', outcome: 'failed' },
          { testId: 'still-failing', label: 'Test::stillFailing', outcome: 'passed' },
        ],
      },
      {
        id: 'new',
        completedAt: '2026-01-02T00:00:00.000Z',
        cases: [
          {
            testId: 'recovered', label: 'Test::recovered', outcome: 'passed',
            filePath: '/workspace/tests/Test.php', line: 20,
          },
          {
            testId: 'still-failing', label: 'Test::stillFailing', outcome: 'failed',
            filePath: '/workspace/tests/Test.php', line: 30, failureMessage: 'Expected true but got false',
          },
          { testId: 'errored', label: 'Test::errored', outcome: 'errored' },
          { testId: 'skipped', label: 'Test::skipped', outcome: 'skipped' },
        ],
      },
    ];

    assert.deepEqual(getLatestTestProblems(history), [
      {
        testId: 'still-failing', label: 'Test::stillFailing', outcome: 'failed',
        completedAt: '2026-01-02T00:00:00.000Z', filePath: '/workspace/tests/Test.php', line: 30,
        failureMessage: 'Expected true but got false',
      },
      { testId: 'errored', label: 'Test::errored', outcome: 'errored', completedAt: '2026-01-02T00:00:00.000Z' },
    ]);
    const problemChoices = createTestInsightChoices(history, 'workspace').filter(({ id }) => id.startsWith('problem:'));
    assert.deepEqual(problemChoices.map(({ label }) => label), [
      'Failed: Test::stillFailing',
      'Errored: Test::errored',
    ]);
    assert.equal(problemChoices[0].testIdentity, 'still-failing');
    assert.equal(problemChoices[0].line, 30);
    assert.match(problemChoices[0].detail, /Expected true but got false/);
  });

  it('limits results and rejects invalid limits', () => {
    const history: RunHistoryRun[] = [{
      id: 'run', completedAt: '2026-01-01T00:00:00.000Z', cases: [
        { testId: 'one', label: 'Test::one', outcome: 'failed' },
        { testId: 'two', label: 'Test::two', outcome: 'errored' },
      ],
    }];
    assert.deepEqual(getLatestTestProblems(history, 1).map(({ testId }) => testId), ['one']);
    assert.deepEqual(getLatestTestProblems(history, 0), []);
  });
});

describe('formatTestInsightForClipboard', () => {
  it('copies the insight summary and complete reported location', () => {
    assert.equal(formatTestInsightForClipboard({
      id: 'flaky:id',
      label: 'Flaky: ExampleTest::testFlaky',
      description: 'api · 1 passed, 1 failed',
      detail: 'Recent outcomes, newest first: passed → failed.',
      filePath: '/workspace/tests/ExampleTest.php',
      line: 18,
    }), [
      'Flaky: ExampleTest::testFlaky',
      'api · 1 passed, 1 failed',
      'Recent outcomes, newest first: passed → failed.',
      'Location: /workspace/tests/ExampleTest.php:18',
    ].join('\n'));
  });

  it('makes an unavailable source location explicit', () => {
    assert.match(formatTestInsightForClipboard({
      id: 'slow:id', label: 'Slow: ExampleTest::testSlow', description: 'api · 120 ms · passed', detail: 'No source.',
    }), /Location: Source location unavailable$/);
  });
});
