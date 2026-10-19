import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupItemsBy } from './grouping';

describe('groupItemsBy', () => {
  it('partitions tests by workspace and retains items without a workspace', () => {
    const items = [
      { name: 'one', workspace: 'app-a' },
      { name: 'two', workspace: 'app-b' },
      { name: 'three', workspace: 'app-a' },
      { name: 'outside' },
    ];

    const result = groupItemsBy(items, (item) => item.workspace);

    assert.deepEqual(result.groups.get('app-a')?.map((item) => item.name), ['one', 'three']);
    assert.deepEqual(result.groups.get('app-b')?.map((item) => item.name), ['two']);
    assert.deepEqual(result.ungrouped.map((item) => item.name), ['outside']);
  });
});
