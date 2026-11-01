import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expandIncludedScopes } from './testScopes';

type Item = { id: string; children: Item[] };

const item = (id: string, ...children: Item[]): Item => ({ id, children });
const ids = (items: Item[]) => items.map(({ id }) => id);
const expand = (roots: Item[], excluded: Item[]) => expandIncludedScopes(
  roots,
  excluded,
  (testItem) => testItem.id,
  (testItem) => testItem.children,
);

describe('expandIncludedScopes', () => {
  it('keeps the selected scopes unchanged when there are no exclusions', () => {
    const roots = [item('suite', item('file'))];
    assert.deepEqual(expand(roots, []), roots);
  });

  it('drops a selected scope when it is explicitly excluded', () => {
    const selected = item('method');
    assert.deepEqual(expand([selected], [selected]), []);
  });

  it('splits a parent scope around excluded descendants and retains allowed siblings', () => {
    const allowedMethod = item('allowed-method');
    const excludedMethod = item('excluded-method', item('excluded-dataset'));
    const unaffectedClass = item('unaffected-class', item('other-method'));
    const suite = item('suite', item('file', item('class', allowedMethod, excludedMethod), unaffectedClass));

    assert.deepEqual(expand([suite], [excludedMethod]), [allowedMethod, unaffectedClass]);
  });

  it('deduplicates overlapping excluded subtrees without losing remaining tests', () => {
    const excludedChild = item('excluded-child');
    const excludedParent = item('excluded-parent', excludedChild);
    const allowed = item('allowed');
    const suite = item('suite', excludedParent, allowed);

    assert.deepEqual(expand([suite], [excludedParent, excludedChild]), [allowed]);
  });
});
