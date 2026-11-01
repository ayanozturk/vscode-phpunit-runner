import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { remapJUnitCases } from './junitMapping';
import type { JUnitTestCase } from './types';

function testCase(message: string, file = '/remote/app/tests/ExampleTest.php'): JUnitTestCase {
  return { name: 'testExample', className: 'ExampleTest', timeSeconds: 0.1, status: 'failed', message, file };
}

describe('JUnit path remapping', () => {
  const mappings = [{ from: '/Users/dev/app', to: '/remote/app' }];

  it('maps report locations and paths embedded in failure messages', () => {
    const [mapped] = remapJUnitCases([
      testCase('Failed in /remote/app/src/Service.php:42'),
    ], mappings);

    assert.equal(mapped.file, '/Users/dev/app/tests/ExampleTest.php');
    assert.equal(mapped.message, 'Failed in /Users/dev/app/src/Service.php:42');
  });

  it('does not rewrite sibling roots or path-like substrings', () => {
    const [mapped] = remapJUnitCases([
      testCase('See /remote/application/src/Service.php and prefix/remote/app/file.php'),
    ], mappings);

    assert.equal(mapped.message, 'See /remote/application/src/Service.php and prefix/remote/app/file.php');
  });

  it('matches Windows separators and prefers the longest configured root', () => {
    const [mapped] = remapJUnitCases([
      testCase('Error at C:\\work\\app\\src\\Thing.php:9', 'C:\\work\\app\\tests\\ExampleTest.php'),
    ], [
      { from: 'D:\\repo', to: 'C:\\work' },
      { from: 'D:\\repo\\app', to: 'C:\\work\\app' },
    ]);

    assert.equal(mapped.file, 'D:/repo/app/tests/ExampleTest.php');
    assert.equal(mapped.message, 'Error at D:/repo/app\\src\\Thing.php:9');
  });

  it('returns a copy unchanged when no mappings are configured', () => {
    const original = testCase('/remote/app/path.php');
    const [mapped] = remapJUnitCases([original], []);

    assert.equal(mapped, original);
    assert.deepEqual(mapped, original);
  });
});
