import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findNarrowestContainingItem } from './cursorTestTarget';

type Item = { id: string; range?: readonly [number, number]; children: Item[] };
const item = (id: string, start?: number, end?: number, ...children: Item[]): Item => ({
  id,
  ...(start === undefined || end === undefined ? {} : { range: [start, end] as const }),
  children,
});
const findAt = (root: Item, position: number) => findNarrowestContainingItem(
  root,
  position,
  (candidate) => candidate.children,
  (candidate, line) => candidate.range !== undefined
    && candidate.range[0] <= line
    && line <= candidate.range[1],
);

describe('findNarrowestContainingItem', () => {
  it('returns the deepest item containing the position', () => {
    const test = item('test', 10, 20);
    const method = item('method', 5, 30, test);
    const file = item('file', 1, 40, method);

    assert.equal(findAt(file, 15), test);
  });

  it('keeps the first matching sibling when ranges overlap', () => {
    const first = item('first', 10, 20);
    const second = item('second', 10, 20);
    const file = item('file', 1, 40, first, second);

    assert.equal(findAt(file, 15), first);
  });

  it('falls back to the deepest containing parent when no child contains the position', () => {
    const method = item('method', 5, 30, item('test', 10, 20));
    const file = item('file', 1, 40, method);

    assert.equal(findAt(file, 25), method);
  });

  it('returns undefined when no item range contains the position', () => {
    const file = item('file', 1, 40, item('method', 5, 30));

    assert.equal(findAt(file, 50), undefined);
  });
});
