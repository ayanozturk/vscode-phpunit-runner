import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import { detectParallelRunner, parallelRunnerArguments } from './parallelRunner';

describe('parallel runner detection', () => {
  it('detects Pest only when the Composer package and executable are present', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit parallel pest '));
    try {
      await fs.mkdir(path.join(workspace, 'vendor', 'bin'), { recursive: true });
      await fs.writeFile(path.join(workspace, 'composer.json'), '{"require-dev":{"pestphp/pest":"^3"}}');
      await fs.writeFile(path.join(workspace, 'vendor', 'bin', 'pest'), '');
      assert.equal(await detectParallelRunner({ workspacePath: workspace, configuredRunner: '' }), 'pest');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('prefers a declared Windows Pest shim over ParaTest when both are installed', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit parallel pest windows '));
    try {
      await fs.mkdir(path.join(workspace, 'vendor', 'bin'), { recursive: true });
      await fs.writeFile(path.join(workspace, 'composer.json'), '{"require":{"pestphp/pest":"^5"}}');
      await fs.writeFile(path.join(workspace, 'vendor', 'bin', 'pest.bat'), '');
      await fs.writeFile(path.join(workspace, 'vendor', 'bin', 'paratest'), '');

      assert.equal(await detectParallelRunner({ workspacePath: workspace, configuredRunner: '' }), 'pest');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('detects Composer shims with cmd and exe extensions', async () => {
    const pestWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit parallel pest cmd '));
    const paratestWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit parallel paratest exe '));
    try {
      await fs.mkdir(path.join(pestWorkspace, 'vendor', 'bin'), { recursive: true });
      await fs.writeFile(path.join(pestWorkspace, 'composer.json'), '{"require-dev":{"pestphp/pest":"^5"}}');
      await fs.writeFile(path.join(pestWorkspace, 'vendor', 'bin', 'pest.cmd'), '');
      assert.equal(await detectParallelRunner({ workspacePath: pestWorkspace, configuredRunner: '' }), 'pest');

      await fs.mkdir(path.join(paratestWorkspace, 'vendor', 'bin'), { recursive: true });
      await fs.writeFile(path.join(paratestWorkspace, 'vendor', 'bin', 'paratest.exe'), '');
      assert.equal(await detectParallelRunner({
        workspacePath: paratestWorkspace,
        configuredRunner: 'vendor/bin/phpunit',
      }), 'paratest');
    } finally {
      await fs.rm(pestWorkspace, { recursive: true, force: true });
      await fs.rm(paratestWorkspace, { recursive: true, force: true });
    }
  });

  it('detects ParaTest beside an explicitly configured PHPUnit runner', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit parallel paratest '));
    try {
      await fs.mkdir(path.join(workspace, 'vendor', 'bin'), { recursive: true });
      await fs.writeFile(path.join(workspace, 'vendor', 'bin', 'paratest'), '');
      assert.equal(await detectParallelRunner({
        workspacePath: workspace,
        configuredRunner: 'vendor/bin/phpunit',
      }), 'paratest');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('does not claim support for opaque commands, Artisan, or incomplete remote templates', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit parallel unsupported '));
    try {
      await fs.mkdir(path.join(workspace, 'vendor', 'bin'), { recursive: true });
      await fs.writeFile(path.join(workspace, 'vendor', 'bin', 'paratest'), '');
      assert.equal(await detectParallelRunner({ workspacePath: workspace, configuredRunner: 'artisan test' }), undefined);
      assert.equal(await detectParallelRunner({ workspacePath: workspace, configuredRunner: 'php artisan test' }), undefined);
      assert.equal(await detectParallelRunner({
        workspacePath: workspace,
        configuredRunner: 'vendor/bin/phpunit',
        commandTemplate: 'ssh host phpunit',
      }), undefined);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('parallel runner arguments', () => {
  it('uses Pest parallel flags and ParaTest process count', () => {
    assert.deepEqual(parallelRunnerArguments('pest', 2), ['--parallel', '--processes=2']);
    assert.deepEqual(parallelRunnerArguments('paratest', 4), ['--processes=4']);
  });

  it('rejects invalid worker counts', () => {
    assert.throws(() => parallelRunnerArguments('pest', 0), /between 1 and 64/);
    assert.throws(() => parallelRunnerArguments('paratest', 1.5), /between 1 and 64/);
  });
});
