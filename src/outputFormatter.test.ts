import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTestOutput,
  formatTestOutputSegments,
  sourceSnippetAtLine,
  sourceSnippetAtLineFromLines,
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
    assert.doesNotMatch(output, /Not applicable/);
  });

  it('formats progress with one status marker per case and a complete count summary', () => {
    assert.equal(stripAnsi(formatTestOutput(cases, 'progress')), '.FES\n4 tests: 1 passed, 1 failed, 1 errors, 1 skipped\n');
  });

  it('counts every outcome once and retains zero counts in compact presets', () => {
    assert.equal(stripAnsi(formatTestOutput(cases, 'progress')), '.FES\n4 tests: 1 passed, 1 failed, 1 errors, 1 skipped\n');
    assert.equal(stripAnsi(formatTestOutput(cases, 'summary')), [
      '4 tests: 1 passed, 1 failed, 1 error, 1 skipped',
      'FAIL testFailure with data set "edge case"',
      '  /tests/ExampleTest.php:24',
      '  Failed asserting false.',
      'ERROR testError',
      '  Runtime exception',
      '',
    ].join('\n'));

    assert.equal(stripAnsi(formatTestOutput([cases[0]], 'progress')), '.\n1 tests: 1 passed, 0 failed, 0 errors, 0 skipped\n');
    assert.equal(stripAnsi(formatTestOutput([cases[0]], 'summary')), '1 test: 1 passed, 0 failed, 0 errors, 0 skipped\n');
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

  it('preserves pretty messages on passed cases and keeps them out of collision output', () => {
    const passedWithMessage = { ...cases[0], message: 'Informational runner note' };

    assert.equal(
      stripAnsi(formatTestOutput([passedWithMessage], 'pretty')),
      'PASS testPass (12 ms)\n  Informational runner note\n',
    );
    assert.equal(
      stripAnsi(formatTestOutput([passedWithMessage], 'collision')),
      '✓ testPass (12 ms)\n',
    );
  });

  it('summarizes all outcomes and shows concise details only for failures and errors', () => {
    const output = stripAnsi(formatTestOutput(cases, 'summary'));

    assert.match(output, /^4 tests: 1 passed, 1 failed, 1 error, 1 skipped$/m);
    assert.match(output, /^FAIL testFailure with data set "edge case"$/m);
    assert.match(output, /^  \/tests\/ExampleTest\.php:24$/m);
    assert.match(output, /^  Failed asserting false\.$/m);
    assert.match(output, /^ERROR testError$/m);
    assert.match(output, /^  Runtime exception$/m);
    assert.doesNotMatch(output, /testPass|testSkipped|Expected true\.|Not applicable/);
  });

  it('keeps duplicate test names as separate outcomes in report order', () => {
    const duplicateCases: JUnitTestCase[] = [
      { ...cases[1], name: 'testRepeated', message: 'First failure' },
      { ...cases[1], name: 'testRepeated', status: 'errored', message: 'Second error' },
    ];

    const collisionOutput = stripAnsi(formatTestOutput(duplicateCases, 'collision'));
    assert.equal((collisionOutput.match(/testRepeated/g) ?? []).length, 2);
    assert.ok(collisionOutput.indexOf('First failure') < collisionOutput.indexOf('Second error'));

    const summaryOutput = stripAnsi(formatTestOutput(duplicateCases, 'summary'));
    assert.match(summaryOutput, /^2 tests: 0 passed, 1 failed, 1 error, 0 skipped$/m);
    assert.ok(summaryOutput.indexOf('First failure') < summaryOutput.indexOf('Second error'));
  });

  it('preserves raw output when no structured report cases are available', () => {
    assert.equal(formatTestOutput([], 'collision', 'dd() output'), 'dd() output\n');
    assert.equal(formatTestOutput([], 'pretty', 'already terminated\n'), 'already terminated\n');
    assert.equal(formatTestOutput([], 'progress', ''), '');
  });

  it('returns distinct, stable content for each supported preset', () => {
    const outputs = (['collision', 'progress', 'pretty', 'summary'] as OutputPreset[])
      .map((preset) => formatTestOutput(cases, preset));
    assert.equal(new Set(outputs).size, 4);
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

  it('returns per-case output locations without changing preset text', () => {
    for (const preset of ['collision', 'pretty'] as OutputPreset[]) {
      const segments = formatTestOutputSegments([cases[1]], preset);
      assert.equal(segments.length, 1);
      assert.deepEqual(segments[0].location, { file: '/tests/ExampleTest.php', line: 24 });
      assert.equal(segments.map((segment) => segment.text).join(''), formatTestOutput([cases[1]], preset));
    }

    const hiddenLocation = formatTestOutputSegments([cases[1]], 'collision', '', new Map(), {
      failureLocation: '',
    });
    assert.equal(hiddenLocation[0].location, undefined);
    assert.equal(formatTestOutputSegments([cases[1]], 'progress')[0].location, undefined);
    assert.deepEqual(formatTestOutputSegments([cases[1]], 'summary')[0].location, {
      file: '/tests/ExampleTest.php',
      line: 24,
    });
    assert.equal(formatTestOutputSegments([cases[1]], 'summary', '', new Map(), {
      failureLocation: '',
    })[0].location, undefined);
  });

  it('supports configurable test-line templates, icons, failure details, and plain output', () => {
    const snippets = new Map([[sourceSnippetKey('/tests/ExampleTest.php', 24), '\u001b[31m  > 24 | failing line\u001b[0m']]);
    const output = formatTestOutput([cases[1]], 'collision', '', snippets, {
      colors: false,
      duration: false,
      icons: { failed: 'NO' },
      testCase: '[{status}] {icon} {name} ({duration})',
      failureLocation: 'at {file}#{line}',
      failureMessage: 'details: {message}',
      sourceSnippet: false,
    });

    assert.equal(output, '[FAIL] NO testFailure with data set "edge case" ()\nat /tests/ExampleTest.php#24\ndetails: Failed asserting false.\nExpected true.\n');
    assert.doesNotMatch(output, /\u001b\[|failing line/);
  });

  it('allows suppressing duration, location, and failure details', () => {
    const output = stripAnsi(formatTestOutput([cases[1]], 'pretty', '', new Map(), {
      duration: false,
      failureLocation: '',
      failureMessage: '',
    }));

    assert.equal(output, 'FAIL testFailure with data set "edge case"\n');
  });

  it('allows progress markers and color to be customized', () => {
    assert.equal(formatTestOutput(cases, 'progress', '', new Map(), {
      colors: false,
      icons: { passed: 'P', failed: 'F!', errored: 'E!', skipped: 'S' },
    }), 'PF!E!S\n4 tests: 1 passed, 1 failed, 1 errors, 1 skipped\n');
  });

  it('keeps custom status placeholders colored unless colors are disabled', () => {
    const output = formatTestOutput([cases[0]], 'collision', '', new Map(), {
      testCase: '{icon} {status} {name}',
    });

    assert.equal(output, '\u001b[32m✓\u001b[0m \u001b[32mPASS\u001b[0m testPass\n');
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

  it('renders cached source lines identically at multiple locations', () => {
    const source = 'first\r\nsecond\r\nthird\r\nfourth';
    const lines = source.split(/\r?\n/);
    for (const line of [1, 2, 4]) {
      assert.equal(
        sourceSnippetAtLineFromLines(lines, line, 1),
        sourceSnippetAtLine(source, line, 1),
      );
    }
  });
});

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}
