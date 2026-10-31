import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapCommandForContainer,
  mapHostPathToContainer,
  normalizePathForComparison,
  resolvePath,
} from './paths';

describe('mapHostPathToContainer', () => {
  it('maps a workspace root and descendants without crossing sibling path boundaries', () => {
    assert.equal(mapHostPathToContainer('/proj', '/proj', '/app'), '/app');
    assert.equal(mapHostPathToContainer('/proj/tests/A Test.php', '/proj', '/app'), '/app/tests/A Test.php');
    assert.equal(mapHostPathToContainer('/project/tests/A.php', '/proj', '/app'), '/project/tests/A.php');
    assert.equal(mapHostPathToContainer('--colors=always', '/proj', '/app'), '--colors=always');
  });

  it('maps descendants when the host workspace is the filesystem root', () => {
    assert.equal(mapHostPathToContainer('/tmp/tests/A.php', '/', '/app'), '/app/tmp/tests/A.php');
  });

  it('maps Windows paths case-insensitively even when tests run on another platform', () => {
    assert.equal(
      mapHostPathToContainer('c:\\Projects\\App\\tests\\A Test.php', 'C:\\Projects\\App', '/app'),
      '/app/tests/A Test.php',
    );
    assert.equal(mapHostPathToContainer('C:\\Projects\\Application\\A.php', 'C:\\Projects\\App', '/app'), 'C:\\Projects\\Application\\A.php');
  });

  it('leaves paths on another Windows drive unchanged', () => {
    assert.equal(mapHostPathToContainer('D:\\tests\\A.php', 'C:\\Projects\\App', '/app'), 'D:\\tests\\A.php');
  });
});

describe('path helpers', () => {
  it('normalizes Windows paths without resolving them against the current host', () => {
    assert.equal(normalizePathForComparison('C:\\Projects\\App\\..\\Tests'), 'c:/projects/tests');
  });

  it('resolves absolute Windows configuration paths and relative paths for Windows workspaces', () => {
    assert.equal(resolvePath('C:\\Projects\\App', 'D:\\configs\\phpunit.xml'), 'D:\\configs\\phpunit.xml');
    assert.equal(resolvePath('C:\\Projects\\App', 'config\\phpunit.xml'), 'C:\\Projects\\App\\config\\phpunit.xml');
  });

  it('maps absolute Windows command paths while leaving command names alone', () => {
    assert.equal(mapCommandForContainer('C:\\Projects\\App\\vendor\\bin\\phpunit', 'C:\\Projects\\App', '/app'), '/app/vendor/bin/phpunit');
    assert.equal(mapCommandForContainer('vendor/bin/phpunit', 'C:\\Projects\\App', '/app'), 'vendor/bin/phpunit');
  });
});
