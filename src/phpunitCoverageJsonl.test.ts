import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePhpUnitCoverageJsonl } from './phpunitCoverageJsonl';

describe('parsePhpUnitCoverageJsonl', () => {
  it('maps test identities and compact line ranges to source files', () => {
    const result = parsePhpUnitCoverageJsonl(
      JSON.stringify({ schemaVersion: 1, sourceRoot: '/project/src', generatedAt: '2026-10-30T00:00:00Z' }),
      [
        JSON.stringify({ test: 'App\\MoneyTest::testFormat#zero', covers: { 'Money.php': ['10-12', '18'] } }),
        JSON.stringify({ test: 'App\\MoneyTest::testFormat#positive', covers: { 'Money.php': ['10-11'], 'Format.php': ['3'] } }),
        '',
      ].join('\n'),
    );

    assert.deepEqual(result, {
      schemaVersion: 1,
      sourceRoot: '/project/src',
      tests: [
        {
          testId: 'App\\MoneyTest::testFormat#zero',
          files: [{ filePath: 'Money.php', lines: [{ start: 10, end: 12 }, { start: 18, end: 18 }] }],
        },
        {
          testId: 'App\\MoneyTest::testFormat#positive',
          files: [
            { filePath: 'Money.php', lines: [{ start: 10, end: 11 }] },
            { filePath: 'Format.php', lines: [{ start: 3, end: 3 }] },
          ],
        },
      ],
    });
  });

  it('skips unsupported records, paths, and malformed ranges without inventing coverage', () => {
    const result = parsePhpUnitCoverageJsonl(
      JSON.stringify({ schemaVersion: 1, sourceRoot: '/project/src' }),
      [
        JSON.stringify({ test: 'App\\Test::testBad', covers: { '../outside.php': ['1'], '/absolute.php': ['2'], 'Bad.php': ['x', '0', '9-4', 12] } }),
        JSON.stringify({ test: 'App\\Test::testGood', covers: { 'Good.php': ['2-4'] } }),
        JSON.stringify({ test: 'App\\Test::testEmpty', covers: {} }),
        JSON.stringify({ test: 'App\\Test::testWindows', covers: { 'C:/outside.php': ['1'], 'folder\\Bad.php': ['2'] } }),
      ].join('\n'),
    );

    assert.deepEqual(result.tests, [
      { testId: 'App\\Test::testGood', files: [{ filePath: 'Good.php', lines: [{ start: 2, end: 4 }] }] },
    ]);
  });

  it('rejects unknown schema versions and malformed JSON lines', () => {
    assert.throws(
      () => parsePhpUnitCoverageJsonl(JSON.stringify({ schemaVersion: 2, sourceRoot: '/src' }), ''),
      /schemaVersion 1/,
    );
    assert.throws(
      () => parsePhpUnitCoverageJsonl('{', ''),
      /meta\.json is not valid JSON/,
    );
    assert.throws(
      () => parsePhpUnitCoverageJsonl(JSON.stringify({ schemaVersion: 1, sourceRoot: '/src' }), '{'),
      /tests\.jsonl contains invalid JSON on line 1/,
    );
  });
});
