import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findIndexedDatasetCases,
  findIndexedFileCases,
  findIndexedMethodCases,
  findIndexedPestCases,
  indexTestCases,
} from './resultIndex';
import type { JUnitTestCase } from './types';

function testCase(overrides: Partial<JUnitTestCase> = {}): JUnitTestCase {
  return {
    name: 'testWorks',
    className: 'App\\Tests\\ExampleTest',
    timeSeconds: 0.01,
    status: 'passed',
    message: '',
    ...overrides,
  };
}

describe('JUnit result index', () => {
  it('matches methods and data sets with normalized PHPUnit class names', () => {
    const methodCase = testCase({ name: 'testValues with data set "first"' });
    const datasetCase = testCase({ name: 'testValues with data set "second"', status: 'failed' });
    const index = indexTestCases([methodCase, datasetCase]);

    assert.deepEqual(findIndexedMethodCases(index, 'App\\Tests\\ExampleTest', 'testValues'), [methodCase, datasetCase]);
    assert.deepEqual(findIndexedDatasetCases(index, 'Tests.ExampleTest', datasetCase.name), [datasetCase]);
  });

  it('groups relative testcase files under their workspace and uses classname for missing file attributes', () => {
    const explicit = testCase({ file: 'tests/ExampleTest.php' });
    const withoutFile = testCase({ name: 'testAlsoWorks', className: 'Tests.ExampleTest' });
    const unrelated = testCase({ className: 'App\\Tests\\OtherTest', file: 'tests/OtherTest.php' });
    const index = indexTestCases([explicit, withoutFile, unrelated], '/workspace');

    assert.deepEqual(
      findIndexedFileCases(index, '/workspace/tests/ExampleTest.php', ['App\\Tests\\ExampleTest']),
      [explicit, withoutFile],
    );
  });

  it('matches Pest names within their file and keeps cases without file metadata eligible', () => {
    const local = testCase({ name: 'adds values with data set #0', file: 'tests/ValuesTest.php' });
    const noFile = testCase({ name: 'adds values with data set #1' });
    const otherFile = testCase({ name: 'adds values with data set #2', file: 'tests/OtherTest.php' });
    const index = indexTestCases([local, noFile, otherFile], '/workspace');

    assert.deepEqual(
      findIndexedPestCases(index, 'adds values', '/workspace/tests/ValuesTest.php'),
      [local, noFile],
    );
  });

  it('indexes large result sets for direct per-method lookups', () => {
    const cases = Array.from({ length: 6000 }, (_, index) => testCase({
      name: `test${index}`,
      className: `App\\Tests\\Example${index}Test`,
    }));
    const indexed = indexTestCases(cases);

    for (let index = 0; index < cases.length; index += 1) {
      assert.equal(
        findIndexedMethodCases(indexed, `App\\Tests\\Example${index}Test`, `test${index}`)[0],
        cases[index],
      );
    }
  });
});
