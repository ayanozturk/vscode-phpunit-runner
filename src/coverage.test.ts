import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { mapCloverCoverage, readCloverReport } from './coverage';

const xml = `<coverage><file name="/remote/app/src/Thing.php">
  <line num="1" type="stmt" count="3"/>
  <line num="2" type="stmt" count="0"/>
  <line num="3" type="method" count="1"/>
  <metrics statements="2" coveredstatements="1"/>
</file></coverage>`;

describe('Clover coverage mapping', () => {
  it('maps file paths and exposes statement details with zero-based conversion left to VS Code', () => {
    assert.deepEqual(mapCloverCoverage(xml, [{ from: '/local/app', to: '/remote/app' }]), [{
      path: '/local/app/src/Thing.php',
      statements: 2,
      coveredStatements: 1,
      details: [{ line: 1, count: 3 }, { line: 2, count: 0 }],
    }]);
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
