import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { continuousTargetsForUri } from './continuousTargets';

interface Item {
  id: string;
  uri?: string;
  files: Item[];
}

const select = (roots: readonly Item[], uri: string) => continuousTargetsForUri(
  roots,
  uri,
  (item) => item.id,
  (item) => item.uri,
  (root) => root.files,
  (file) => file.uri,
);

describe('continuousTargetsForUri', () => {
  it('selects a matching workspace root before searching its files', () => {
    const root: Item = {
      id: 'workspace',
      uri: 'file:///project',
      files: [{ id: 'file', uri: 'file:///project/Test.php', files: [] }],
    };

    assert.deepEqual(select([root], 'file:///project'), [root]);
  });

  it('selects the matching file within the root and preserves root order', () => {
    const firstFile: Item = { id: 'first', uri: 'file:///a/Test.php', files: [] };
    const secondFile: Item = { id: 'second', uri: 'file:///b/Test.php', files: [] };
    const roots: Item[] = [
      { id: 'a', files: [firstFile] },
      { id: 'b', files: [secondFile] },
    ];

    assert.deepEqual(select(roots, 'file:///b/Test.php'), [secondFile]);
  });

  it('deduplicates repeated targets by stable ID and ignores unmatched URIs', () => {
    const file: Item = { id: 'shared', uri: 'file:///project/Test.php', files: [] };
    const roots: Item[] = [
      { id: 'a', files: [file] },
      { id: 'b', files: [file] },
    ];

    assert.deepEqual(select(roots, 'file:///project/Test.php'), [file]);
    assert.deepEqual(select(roots, 'file:///missing.php'), []);
  });
});
