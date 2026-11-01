import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatTestInsightsReport } from './insightReport';
import type { RunHistoryRun } from './runHistory';

describe('formatTestInsightsReport', () => {
  it('formats bounded slow, flaky, and latest-problem insights with source locations', () => {
    const history: RunHistoryRun[] = [
      {
        id: 'older',
        completedAt: '2026-01-01T00:00:00.000Z',
        cases: [
          {
            testId: 'slow', label: 'ExampleTest::testSlow', outcome: 'passed', durationMs: 251,
            filePath: '/project/tests/ExampleTest.php', line: 8,
          },
          { testId: 'flaky', label: 'ExampleTest::testFlaky', outcome: 'failed', durationMs: 12 },
          {
            testId: 'broken', label: 'ExampleTest::testBroken', outcome: 'failed', durationMs: 30,
            failureMessage: 'Expected false', filePath: '/project/tests/ExampleTest.php', line: 22,
          },
          { testId: 'second-slow', label: 'ExampleTest::testSecondSlow', outcome: 'passed', durationMs: 150 },
        ],
      },
      {
        id: 'newer',
        completedAt: '2026-01-02T00:00:00.000Z',
        cases: [{ testId: 'flaky', label: 'ExampleTest::testFlaky', outcome: 'passed', durationMs: 10 }],
      },
    ];

    const report = formatTestInsightsReport([{ name: 'workspace-a', history }], 1);
    assert.match(report, /^# PHPUnit Test Insights\n\n## workspace-a/);
    assert.match(report, /### Slowest tests\n- ExampleTest::testSlow — 251 ms \(passed\), 2026-01-01 — `\/project\/tests\/ExampleTest\.php:8`/);
    assert.match(report, /### Flaky candidates\n- ExampleTest::testFlaky — passed → failed/);
    assert.match(report, /### Latest failures and errors\n- ExampleTest::testBroken — failed: Expected false — `\/project\/tests\/ExampleTest\.php:22`/);
    assert.doesNotMatch(report, /testSecondSlow/);
  });

  it('returns a clear empty-state report when no workspaces have history', () => {
    assert.equal(
      formatTestInsightsReport([{ name: 'empty', history: [] }]),
      '# PHPUnit Test Insights\n\nNo completed, reported test runs are available yet.',
    );
  });
});
