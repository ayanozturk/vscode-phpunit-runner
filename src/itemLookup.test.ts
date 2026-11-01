import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findTreeItemById } from './itemLookup';

interface Item {
  id: string;
  children: Item[];
}

const find = (roots: readonly Item[], id: string): Item | undefined => findTreeItemById(
  roots,
  id,
  (item) => item.id,
  (item) => item.children,
);

describe('findTreeItemById', () => {
  it('finds roots and nested items', () => {
    const nested: Item = { id: 'nested', children: [] };
    const root: Item = { id: 'root', children: [{ id: 'branch', children: [nested] }] };

    assert.equal(find([root], 'root'), root);
    assert.equal(find([root], 'nested'), nested);
  });

  it('preserves the previous last-child-first traversal for duplicate IDs', () => {
    const first: Item = { id: 'duplicate', children: [] };
    const second: Item = { id: 'duplicate', children: [] };
    const root: Item = { id: 'root', children: [first, second] };

    assert.equal(find([root], 'duplicate'), second);
  });

  it('returns undefined when the ID is absent', () => {
    assert.equal(find([{ id: 'root', children: [] }], 'missing'), undefined);
  });
});
