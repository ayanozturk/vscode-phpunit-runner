import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTestOutput,
  sourceSnippetAtLine,
  sourceSnippetKey,
  type OutputPreset,
} from './outputFormatter';
import type { JUnitTestCase } from './types';

const cases: JUnitTestCase[] = [
  {
    name: 'testPass', className: 'ExampleTest', timeSeconds: 0.0124, status: 'passed', message: '',
  },
  {
    name: 'testFailure with data set "edge case"', className: 'ExampleTest', timeSeconds: 0.5,
    status: 'failed', message: 'Failed asserting false.\nExpected true.', file: '/tests/ExampleTest.php', line: 24,
  },
  {
    name: 'testError', className: 'ExampleTest', timeSeconds: 0.001, status: 'errored', message: 'Runtime exception',
  },
  {
    name: 'testSkipped', className: 'ExampleTest', timeSeconds: 0, status: 'skipped', message: 'Not applicable',
  },
];

describe('formatTestOutput', () => {
  it('formats detailed cases with readable outcomes, duration, location, and multiline failure text', () => {
    const snippets = new Map([[sourceSnippetKey('/tests/ExampleTest.php', 24), sourceSnippetAtLine(
      '    public function testFailure(): void {\n        $this->assertTrue(false);\n    }',
      2,
    )!]]);
    const output = stripAnsi(formatTestOutput(cases, 'collision', '', snippets));
    assert.match(output, /^✓ testPass \(12 ms\)$/m);
    assert.match(output, /^✗ testFailure with data set "edge case" \(500 ms\)$/m);
    assert.match(output, /^  \/tests\/ExampleTest\.php:24$/m);
    assert.match(output, /^  Failed asserting false\.\n  Expected true\.$/m);
    assert.match(output, /^  > 2 \|         \$this->assertTrue\(false\);$/m);
    assert.match(output, /^! testError \(1 ms\)$/m);
    assert.match(output, /^– testSkipped \(0 ms\)$/m);
  });

  it('formats progress with one status marker per case and a complete count summary', () => {
    assert.equal(stripAnsi(formatTestOutput(cases, 'progress')), '.FES\n4 tests: 1 passed, 1 failed, 1 errors, 1 skipped\n');
  });

  it('formats pretty output as plain per-case status lines without icons', () => {
    const output = stripAnsi(formatTestOutput(cases, 'pretty'));
    assert.match(output, /^PASS testPass \(12 ms\)$/m);
    assert.match(output, /^FAIL testFailure with data set "edge case" \(500 ms\)$/m);
    assert.match(output, /^  Failed asserting false\.$/m);
    assert.match(output, /^ERROR testError \(1 ms\)$/m);
    assert.match(output, /^SKIP testSkipped \(0 ms\)$/m);
    assert.doesNotMatch(output, /[✓✗]/);
  });

  it('preserves raw output when no structured report cases are available', () => {
    assert.equal(formatTestOutput([], 'collision', 'dd() output'), 'dd() output\n');
    assert.equal(formatTestOutput([], 'pretty', 'already terminated\n'), 'already terminated\n');
    assert.equal(formatTestOutput([], 'progress', ''), '');
  });

  it('returns distinct, stable content for each supported preset', () => {
    const outputs = (['collision', 'progress', 'pretty'] as OutputPreset[])
      .map((preset) => formatTestOutput(cases, preset));
    assert.equal(new Set(outputs).size, 3);
  });

  it('colors outcome markers and keeps remote failure output useful without a local snippet', () => {
    const output = formatTestOutput(cases, 'collision');
    assert.ok(output.includes('\u001b[32m✓\u001b[0m'));
    assert.ok(output.includes('\u001b[31m✗\u001b[0m'));
    assert.ok(output.includes('/tests/ExampleTest.php:24'));
    assert.ok(output.includes('Failed asserting false.'));
    assert.ok(!output.includes('assertTrue(false)'));
  });

  it('uses a source location embedded in the failure message ahead of the test file location', () => {
    const testCase = {
      ...cases[1],
      message: 'Failed assertion.\n  at /workspace/src/Service.php:12',
    };
    const snippets = new Map([[
      sourceSnippetKey('/workspace/src/Service.php', 12),
      sourceSnippetAtLine('<?php\nreturn false;\n', 2)!,
    ]]);
    const output = stripAnsi(formatTestOutput([testCase], 'collision', '', snippets));

    assert.match(output, /^  \/workspace\/src\/Service\.php:12$/m);
    assert.match(output, /^  > 2 \| return false;$/m);
    assert.doesNotMatch(output, /\/tests\/ExampleTest\.php:24/);
  });

  it('includes source locations and snippets in the per-test preset', () => {
    const snippets = new Map([[sourceSnippetKey('/tests/ExampleTest.php', 24), '  > 24 | failing statement']]);
    const output = stripAnsi(formatTestOutput(cases, 'pretty', '', snippets));

    assert.match(output, /^  \/tests\/ExampleTest\.php:24$/m);
    assert.match(output, /^  > 24 \| failing statement$/m);
  });
});

describe('sourceSnippetAtLine', () => {
  it('returns a small line-numbered frame and highlights the failing line', () => {
    const snippet = sourceSnippetAtLine('first\nfailing line\nthird', 2);
    assert.equal(stripAnsi(snippet ?? ''), '    1 | first\n  > 2 | failing line\n    3 | third');
    assert.ok(snippet?.includes('\u001b[31m  > 2 | failing line\u001b[0m'));
  });

  it('clamps context at file boundaries and rejects unavailable lines', () => {
    assert.equal(stripAnsi(sourceSnippetAtLine('only', 1, 2) ?? ''), '  > 1 | only');
    assert.equal(sourceSnippetAtLine('first\nsecond', 3), undefined);
    assert.equal(sourceSnippetAtLine('', 1), undefined);
  });
});

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}
