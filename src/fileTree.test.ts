import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectFileTreeItems } from './fileTree';
import type { TestItemKind } from './types';

type Node = { name: string; kind: TestItemKind; children: Node[] };

describe('collectFileTreeItems', () => {
  it('collects nested file nodes in workspace tree order', () => {
    const firstFile: Node = { name: 'AlphaTest.php', kind: 'file', children: [] };
    const nestedFile: Node = { name: 'CheckoutTest.php', kind: 'file', children: [] };
    const lastFile: Node = { name: 'BetaTest.php', kind: 'file', children: [] };
    const root: Node = {
      name: 'root',
      kind: 'suite',
      children: [
        { name: 'unit', kind: 'suite', children: [firstFile] },
        { name: 'feature', kind: 'suite', children: [{ name: 'checkout', kind: 'folder', children: [nestedFile] }] },
        lastFile,
      ],
    };

    assert.deepEqual(
      collectFileTreeItems(root, (item) => item.kind, (item) => item.children).map((item) => item.name),
      ['AlphaTest.php', 'CheckoutTest.php', 'BetaTest.php'],
    );
  });

  it('returns a selected file without traversing its test method children', () => {
    const method: Node = { name: 'testCreatesOrder', kind: 'method', children: [] };
    const file: Node = { name: 'OrderTest.php', kind: 'file', children: [method] };

    assert.deepEqual(collectFileTreeItems(file, (item) => item.kind, (item) => item.children), [file]);
  });
});
