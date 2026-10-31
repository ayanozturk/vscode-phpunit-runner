import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findWithGlobs } from './workspaceDiscovery';

describe('workspace-scoped test discovery', () => {
  it('runs every include glob within its owning workspace root and deduplicates results', async () => {
    const roots = ['workspace-a', 'workspace-b'];
    const calls: Array<{ root: string | undefined; pattern: string; exclude: string | undefined }> = [];
    const unique = new Map<string, string>();

    for (const root of roots) {
      await findWithGlobs(
        ['tests/**/*.php', '**/*Test.php'],
        ['**/vendor/**', '**/node_modules/**'],
        unique,
        root,
        async (pattern, exclude, scope) => {
          calls.push({ root: scope, pattern, exclude });
          if (pattern === 'tests/**/*.php') {
            return [`${scope}/tests/AlphaTest.php`];
          }
          return [`${scope}/tests/AlphaTest.php`, `${scope}/OtherTest.php`];
        },
        (result) => result,
      );
    }

    assert.deepEqual(calls.map(({ root, pattern }) => [root, pattern]), [
      ['workspace-a', 'tests/**/*.php'],
      ['workspace-a', '**/*Test.php'],
      ['workspace-b', 'tests/**/*.php'],
      ['workspace-b', '**/*Test.php'],
    ]);
    assert.ok(calls.every(({ exclude }) => exclude === '{**/vendor/**,**/node_modules/**}'));
    assert.deepEqual([...unique.keys()], [
      'workspace-a/tests/AlphaTest.php',
      'workspace-a/OtherTest.php',
      'workspace-b/tests/AlphaTest.php',
      'workspace-b/OtherTest.php',
    ]);
  });

  it('allows an unscoped search when there are no workspace folders', async () => {
    const unique = new Map<string, string>();
    const found = await findWithGlobs(
      ['**/*Test.php'],
      [],
      unique,
      undefined,
      async (pattern, exclude, scope) => {
        assert.equal(pattern, '**/*Test.php');
        assert.equal(exclude, undefined);
        assert.equal(scope, undefined);
        return ['standalone/Test.php'];
      },
      (result) => result,
    );

    assert.deepEqual(found, ['standalone/Test.php']);
  });
});
