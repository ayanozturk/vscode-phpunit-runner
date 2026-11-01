import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expandCoverageLineNumbers } from './coverageLineRanges';

describe('expandCoverageLineNumbers', () => {
  it('expands inclusive ranges in input order', () => {
    assert.deepEqual(expandCoverageLineNumbers([
      { start: 2, end: 4 },
      { start: 8, end: 8 },
    ]), [2, 3, 4, 8]);
  });

  it('returns no lines for empty or inverted ranges', () => {
    assert.deepEqual(expandCoverageLineNumbers([]), []);
    assert.deepEqual(expandCoverageLineNumbers([{ start: 5, end: 4 }]), []);
  });

  it('preserves overlapping ranges instead of changing coverage identity', () => {
    assert.deepEqual(expandCoverageLineNumbers([
      { start: 1, end: 3 },
      { start: 3, end: 4 },
    ]), [1, 2, 3, 3, 4]);
  });
});
