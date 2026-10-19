import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupItemsBy, runGroupsSequentially } from './grouping';

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

describe('runGroupsSequentially', () => {
  it('executes each workspace group with its own items and stops after cancellation', async () => {
    const groups = new Map([
      ['workspace-a', ['a1', 'a2']],
      ['workspace-b', ['b1']],
    ]);
    const invocations: Array<[string, string[]]> = [];
    let cancelled = false;

    await runGroupsSequentially(groups, () => cancelled, async (workspace, items) => {
      invocations.push([workspace, items]);
      cancelled = true;
    });

    assert.deepEqual(invocations, [['workspace-a', ['a1', 'a2']]]);
  });
});
