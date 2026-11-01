import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { datasetCasesForMethod } from './datasetCases';
import type { JUnitTestCase } from './types';

function testCase(name: string): JUnitTestCase {
  return { name, className: 'ExampleTest', timeSeconds: 0, status: 'passed', message: '' };
}

describe('datasetCasesForMethod', () => {
  it('selects matching data sets and preserves report order', () => {
    const first = testCase('testValues with data set "first"');
    const unrelated = testCase('testAnotherMethod with data set "other"');
    const second = testCase('testValues with data set "second"');

    assert.deepEqual(datasetCasesForMethod('testValues', [first, unrelated, second]), [
      { testCase: first, suffix: 'with data set "first"' },
      { testCase: second, suffix: 'with data set "second"' },
    ]);
  });

  it('returns no data sets when the method is unknown', () => {
    assert.deepEqual(datasetCasesForMethod(undefined, [testCase('testValues with data set "first"')]), []);
  });
});
