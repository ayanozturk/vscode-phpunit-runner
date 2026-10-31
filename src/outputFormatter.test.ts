import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatTestOutput, type OutputPreset } from './outputFormatter';
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
    const output = formatTestOutput(cases, 'collision');
    assert.match(output, /^✓ testPass \(12 ms\)$/m);
    assert.match(output, /^✗ testFailure with data set "edge case" \(500 ms\)$/m);
    assert.match(output, /^  \/tests\/ExampleTest\.php:24$/m);
    assert.match(output, /^  Failed asserting false\.\n  Expected true\.$/m);
    assert.match(output, /^! testError \(1 ms\)$/m);
    assert.match(output, /^– testSkipped \(0 ms\)$/m);
  });

  it('formats progress with one status marker per case and a complete count summary', () => {
    assert.equal(formatTestOutput(cases, 'progress'), '.FES\n4 tests: 1 passed, 1 failed, 1 errors, 1 skipped\n');
  });

  it('formats pretty output as plain per-case status lines without icons', () => {
    const output = formatTestOutput(cases, 'pretty');
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
});
