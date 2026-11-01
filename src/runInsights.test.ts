import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestInsightChoices } from './runInsights';
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
        label: 'ExampleTest::testFlaky',
        description: 'api · 120 ms · passed',
        detail: 'Slowest test in its latest reported run. Select to open its source file.',
        filePath: '/workspace/tests/ExampleTest.php',
        line: 18,
      },
      {
        id: 'flaky:workspace::ExampleTest::testFlaky',
        label: 'ExampleTest::testFlaky',
        description: 'api · possible flaky · 1 passed, 1 failed',
        detail: 'Both pass and fail outcomes appeared within the latest 10 reported runs. Select to open its source file.',
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
});
