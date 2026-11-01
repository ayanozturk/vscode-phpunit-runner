import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  canRequestLocalPhpUnitJsonlCoverage,
  matchPhpUnitCoverageMethodItem,
  mapPhpUnitCoverageFiles,
  parsePhpUnitCoverageJsonl,
  parsePhpUnitCoverageTestMethodId,
  readPhpUnitCoverageJsonl,
  supportsPhpUnitJsonlCoverage,
} from './phpunitCoverageJsonl';

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
        JSON.stringify({ test: 'App\\Test::testBad', covers: { '../outside.php': ['1'], '/absolute.php': ['2'], 'Bad.php': ['x', '0', '9-4', 12], 'Bad\0.php': ['4'] } }),
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

describe('PHPUnit JSONL coverage integration helpers', () => {
  it('limits JSONL coverage to the shared local Composer PHPUnit binary', () => {
    const local = {
      workspacePath: '/project',
      phpunitExecutable: '/project/vendor/bin/phpunit',
      dockerEnabled: false,
      commandTemplate: '',
    };
    assert.equal(canRequestLocalPhpUnitJsonlCoverage(local), true);
    assert.equal(canRequestLocalPhpUnitJsonlCoverage({ ...local, dockerEnabled: true }), false);
    assert.equal(canRequestLocalPhpUnitJsonlCoverage({ ...local, commandTemplate: 'ssh host ${phpunit}' }), false);
    assert.equal(canRequestLocalPhpUnitJsonlCoverage({ ...local, phpunitExecutable: 'phpunit' }), false);
  });

  it('enables only stable PHPUnit versions that provide JSONL coverage', () => {
    for (const version of [undefined, '10.5.66', '12.5.42', '13.3.9', '13.4.0-dev']) {
      assert.equal(supportsPhpUnitJsonlCoverage(version), false);
    }
    assert.equal(supportsPhpUnitJsonlCoverage('13.4.0'), true);
    assert.equal(supportsPhpUnitJsonlCoverage('v13.4.5'), true);
    assert.equal(supportsPhpUnitJsonlCoverage('14.0.0'), true);
  });

  it('rejects relative report roots rather than resolving them against the extension process cwd', () => {
    assert.throws(() => parsePhpUnitCoverageJsonl(
      JSON.stringify({ schemaVersion: 1, sourceRoot: 'src' }),
      '',
    ), /absolute sourceRoot/);
  });

  it('maps report-relative paths through remote-to-host path mappings', () => {
    const report = parsePhpUnitCoverageJsonl(
      JSON.stringify({ schemaVersion: 1, sourceRoot: '/container/app/src' }),
      JSON.stringify({ test: 'App\\MoneyTest::testFormat', covers: { 'Money.php': ['10-12'] } }),
    );

    assert.deepEqual(mapPhpUnitCoverageFiles(report, [{ from: '/host/project', to: '/container/app' }]), [
      {
        path: '/host/project/src/Money.php',
        tests: [{ testId: 'App\\MoneyTest::testFormat', lines: [{ start: 10, end: 12 }] }],
      },
    ]);
  });

  it('merges repeated test identities instead of discarding earlier line coverage', () => {
    const report = parsePhpUnitCoverageJsonl(
      JSON.stringify({ schemaVersion: 1, sourceRoot: '/project/src' }),
      [
        JSON.stringify({ test: 'App\\MoneyTest::testFormat', covers: { 'Money.php': ['10-12', '20'] } }),
        JSON.stringify({ test: 'App\\MoneyTest::testFormat', covers: { 'Money.php': ['12-15', '30'] } }),
      ].join('\n'),
    );

    assert.deepEqual(mapPhpUnitCoverageFiles(report), [{
      path: '/project/src/Money.php',
      tests: [{
        testId: 'App\\MoneyTest::testFormat',
        lines: [{ start: 10, end: 15 }, { start: 20, end: 20 }, { start: 30, end: 30 }],
      }],
    }]);
  });

  it('maps only exact non-data-provider PHPUnit method identifiers', () => {
    assert.deepEqual(parsePhpUnitCoverageTestMethodId('App\\MoneyTest::testFormat'), {
      className: 'App\\MoneyTest',
      methodName: 'testFormat',
    });
    assert.equal(parsePhpUnitCoverageTestMethodId('App\\MoneyTest::testFormat#positive'), undefined);
    assert.equal(parsePhpUnitCoverageTestMethodId('App\\MoneyTest::testFormat (repetition 2 of 3)'), undefined);
    assert.equal(parsePhpUnitCoverageTestMethodId('not-a-phpunit-id'), undefined);
  });

  it('maps coverage identities only to one exact method in the owning workspace', () => {
    const candidates = [
      { itemId: 'item-a', workspacePath: '/project-a', className: '\\App\\MoneyTest', methodName: 'testFormat' },
      { itemId: 'item-b', workspacePath: '/project-b', className: 'App\\MoneyTest', methodName: 'testFormat' },
      { itemId: 'item-c', workspacePath: '/project-a', className: 'App\\MoneyTest', methodName: 'testOther' },
    ];
    assert.equal(matchPhpUnitCoverageMethodItem('App\\MoneyTest::testFormat', '/project-a', candidates), 'item-a');
    assert.equal(matchPhpUnitCoverageMethodItem('App\\MoneyTest::testFormat', '/missing', candidates), undefined);
    assert.equal(matchPhpUnitCoverageMethodItem('App\\MoneyTest::testFormat#positive', '/project-a', candidates), undefined);
    assert.equal(matchPhpUnitCoverageMethodItem('App\\MoneyTest::testFormat', '/project-a', [
      ...candidates,
      { itemId: 'item-duplicate', workspacePath: '/project-a', className: 'App\\MoneyTest', methodName: 'testFormat' },
    ]), undefined);
  });

  it('keeps missing reports as an optional warning so aggregate coverage can remain available', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit-jsonl-missing-'));
    try {
      const result = await readPhpUnitCoverageJsonl(directory);
      assert.equal(result.report, undefined);
      assert.match(result.warning ?? '', /per-test coverage details are unavailable/);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
