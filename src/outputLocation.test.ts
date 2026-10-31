import assert from 'node:assert/strict';
import * as path from 'path';
import { describe, it } from 'node:test';
import { resolveOutputFilePath } from './outputLocation';

describe('resolveOutputFilePath', () => {
  it('resolves relative failure paths from the owning workspace', () => {
    assert.equal(
      resolveOutputFilePath('tests/ExampleTest.php', 12, '/work/api'),
      path.join('/work/api', 'tests', 'ExampleTest.php'),
    );
  });

  it('unmaps a remote failure path before resolving the local file', () => {
    assert.equal(
      resolveOutputFilePath('/container/api/src/Service.php', 8, '/work/api', [
        { from: '/work/api', to: '/container/api' },
      ]),
      '/work/api/src/Service.php',
    );
  });

  it('does not invent a path when the report has no file or valid line', () => {
    assert.equal(resolveOutputFilePath(undefined, 4, '/work/api'), undefined);
    assert.equal(resolveOutputFilePath('tests/ExampleTest.php', undefined, '/work/api'), undefined);
    assert.equal(resolveOutputFilePath('tests/ExampleTest.php', 0, '/work/api'), undefined);
  });

  it('does not treat an unmapped Windows path as a local path on POSIX', () => {
    if (process.platform !== 'win32') {
      assert.equal(resolveOutputFilePath('C:\\remote\\tests\\ExampleTest.php', 12, '/work/api'), undefined);
    }
  });
});
