import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { after, before, describe, it } from 'node:test';
import { readFrameworkInfo } from './frameworkInfo';

describe('readFrameworkInfo', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit-runner-framework-info-'));
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns empty metadata when Composer files are absent', async () => {
    const info = await readFrameworkInfo(root);

    assert.equal(info.pestDeclared, false);
    assert.deepEqual([...info.versions], []);
  });

  it('ignores invalid manifest and lock files independently', async () => {
    await fs.writeFile(path.join(root, 'composer.json'), '{invalid json', 'utf8');
    await fs.writeFile(path.join(root, 'composer.lock'), '{invalid json', 'utf8');

    const info = await readFrameworkInfo(root);

    assert.equal(info.pestDeclared, false);
    assert.deepEqual([...info.versions], []);
  });

  it('reads Pest declarations and locked Pest and PHPUnit versions', async () => {
    await fs.writeFile(path.join(root, 'composer.json'), JSON.stringify({
      require: { 'pestphp/pest': '^3.0' },
      'require-dev': { 'phpunit/phpunit': '^11.0' },
    }), 'utf8');
    await fs.writeFile(path.join(root, 'composer.lock'), JSON.stringify({
      packages: [{ name: 'phpunit/phpunit', version: '11.5.0' }],
      'packages-dev': [{ name: 'pestphp/pest', version: '3.8.0' }],
    }), 'utf8');

    const info = await readFrameworkInfo(root);

    assert.equal(info.pestDeclared, true);
    assert.deepEqual([...info.versions], [
      ['phpunit/phpunit', '11.5.0'],
      ['pestphp/pest', '3.8.0'],
    ]);
  });
});
