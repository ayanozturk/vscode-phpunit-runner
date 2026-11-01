import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { commandAvailable, firstCommandToken } from './commandAvailability';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

describe('command availability', () => {
  it('extracts a command token from plain and quoted runner commands', () => {
    assert.equal(firstCommandToken('phpunit --configuration phpunit.xml'), 'phpunit');
    assert.equal(firstCommandToken('"/tools/php unit" --verbose'), '/tools/php unit');
    assert.equal(firstCommandToken("'C:\\Program Files\\php\\php.exe' -v"), 'C:\\Program Files\\php\\php.exe');
    assert.equal(firstCommandToken('   '), '');
  });

  it('finds executables in PATH entries, including entries after a missing directory', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit-command-path-'));
    temporaryDirectories.push(directory);
    const bin = path.join(directory, 'bin');
    await fs.mkdir(bin);
    const executable = path.join(bin, 'phpunit');
    await fs.writeFile(executable, '#!/bin/sh\nexit 0\n');
    await fs.chmod(executable, 0o755);
    const missingEntries = Array.from({ length: 10 }, (_, index) => path.join(directory, `missing-${index}`));

    assert.equal(
      await commandAvailable('phpunit', directory, { pathValue: [...missingEntries, bin].join(path.delimiter) }),
      true,
    );
    assert.equal(await commandAvailable('absent-runner', directory, { pathValue: bin }), false);
  });

  it('resolves explicit relative command paths against the working directory', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit-command-path-'));
    temporaryDirectories.push(directory);
    const executable = path.join(directory, 'bin', 'phpunit');
    await fs.mkdir(path.dirname(executable));
    await fs.writeFile(executable, '#!/bin/sh\nexit 0\n');
    await fs.chmod(executable, 0o755);

    assert.equal(await commandAvailable('./bin/phpunit', directory, { pathValue: '' }), true);
  });
});
