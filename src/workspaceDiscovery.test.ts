import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findAcrossScopes, findWithGlobs } from './workspaceDiscovery';

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

  it('overlaps independent glob searches and preserves configured result order', async () => {
    const includes = ['first/**/*.php', 'second/**/*.php'];
    let started = 0;
    let overlapped = false;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => { release = resolve; });
    const timeout = setTimeout(release, 100);
    const unique = new Map<string, string>();

    try {
      const found = await findWithGlobs(
        includes,
        [],
        unique,
        'workspace',
        async (pattern) => {
          started += 1;
          if (started === includes.length) {
            overlapped = true;
            release();
          }
          await bothStarted;
          return [pattern];
        },
        (result) => result,
      );

      assert.equal(overlapped, true, 'all glob searches start before any result is collected');
      assert.deepEqual(found, includes);
    } finally {
      clearTimeout(timeout);
    }
  });

  it('overlaps independent workspace roots and preserves root order while deduplicating', async () => {
    type Result = { path: string; root: string };
    let firstPending = true;
    let overlapped = false;
    let resolveFirst!: (results: Result[]) => void;

    const found = await findAcrossScopes(
      ['workspace-a', 'workspace-b'],
      async (root) => {
        if (root === 'workspace-a') {
          return new Promise<Result[]>((resolve) => {
            resolveFirst = (results) => {
              firstPending = false;
              resolve(results);
            };
          });
        }

        overlapped = firstPending;
        resolveFirst([
          { path: 'shared.php', root: 'workspace-a' },
          { path: 'first.php', root: 'workspace-a' },
        ]);
        return [
          { path: 'shared.php', root: 'workspace-b' },
          { path: 'second.php', root: 'workspace-b' },
        ];
      },
      (result) => result.path,
    );

    assert.equal(overlapped, true, 'the second root starts before the first root finishes');
    assert.deepEqual(found, [
      { path: 'shared.php', root: 'workspace-b' },
      { path: 'first.php', root: 'workspace-a' },
      { path: 'second.php', root: 'workspace-b' },
    ]);
  });
});
