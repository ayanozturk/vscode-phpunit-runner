import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { mapCloverCoverage, readCloverReport } from './coverage';

const xml = `<coverage><file name="/remote/app/src/Thing.php">
  <line num="1" type="stmt" count="3"/>
  <line num="2" type="stmt" count="0"/>
  <line num="3" type="method" count="1" signature="run(): void"/>
  <metrics statements="2" coveredstatements="1" methods="1" coveredmethods="1"/>
</file></coverage>`;

describe('Clover coverage mapping', () => {
  it('maps file paths and exposes statement details with zero-based conversion left to VS Code', () => {
    assert.deepEqual(mapCloverCoverage(xml, [{ from: '/local/app', to: '/remote/app' }]), [{
      path: '/local/app/src/Thing.php',
      statements: 2,
      coveredStatements: 1,
      details: [{ line: 1, count: 3 }, { line: 2, count: 0 }],
      declarations: [{ name: 'run', line: 3, count: 1 }],
      methods: 1,
      coveredMethods: 1,
    }]);
  });

  it('keeps statement details when Clover has no declaration data', () => {
    const [file] = mapCloverCoverage(`<coverage><file name="/app/OnlyStatements.php">
      <line num="7" type="stmt" count="2"/>
      <metrics statements="1" coveredstatements="1"/>
    </file></coverage>`, []);

    assert.deepEqual(file.details, [{ line: 7, count: 2 }]);
    assert.deepEqual(file.declarations, []);
    assert.equal(file.methods, undefined);
  });

  it('does not apply a remote path mapping to a sibling path with the same prefix', () => {
    const siblingXml = xml.replace('/remote/app/src/Thing.php', '/remote/application/src/Thing.php');
    const [file] = mapCloverCoverage(siblingXml, [{ from: '/local/app', to: '/remote/app' }]);

    assert.equal(file.path, '/remote/application/src/Thing.php');
  });

  it('keeps a readable empty report available and returns no mapped files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit-runner-clover-empty-'));
    try {
      const reportPath = path.join(directory, 'coverage.xml');
      await fs.writeFile(reportPath, '  \n', 'utf8');

      assert.deepEqual(await readCloverReport(reportPath), { files: [], available: true });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('returns an unavailable result for a report path that cannot be read', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit-runner-clover-unreadable-'));
    try {
      const unreadable = await readCloverReport(directory);
      assert.equal(unreadable.available, false);
      assert.deepEqual(unreadable.files, []);
      assert.ok(unreadable.warning);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('reads reports and reports missing artifacts explicitly', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit-runner-clover-'));
    try {
      const missing = await readCloverReport(path.join(directory, 'missing.xml'));
      assert.equal(missing.available, false);
      assert.deepEqual(missing.files, []);
      assert.ok(missing.warning);

      const reportPath = path.join(directory, 'coverage.xml');
      await fs.writeFile(reportPath, xml, 'utf8');
      const report = await readCloverReport(reportPath);
      assert.equal(report.available, true);
      assert.equal(report.files[0].coveredStatements, 1);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
