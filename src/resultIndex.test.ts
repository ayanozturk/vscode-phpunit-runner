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

  it('matches PHP class and method identifiers without regard to casing', () => {
    const methodCase = testCase({ className: 'App\\Tests\\ExampleTest', name: 'TestValues' });
    const datasetCase = testCase({
      className: 'app\\tests\\exampletest',
      name: 'testValues with data set "First Case"',
    });
    const index = indexTestCases([methodCase, datasetCase]);

    assert.deepEqual(findIndexedMethodCases(index, 'app.tests.exampletest', 'testvalues'), [methodCase, datasetCase]);
    assert.deepEqual(
      findIndexedDatasetCases(index, 'APP\\TESTS\\EXAMPLETEST', 'TESTVALUES with data set "First Case"'),
      [datasetCase],
      'method-name casing is ignored while the data set label remains case-sensitive',
    );
  });

  it('prefers a normalized fully qualified class over an ambiguous short-name suffix', () => {
    const firstNamespace = testCase({ name: 'testSame', className: 'App\\One\\ExampleTest' });
    const secondNamespace = testCase({ name: 'testSame', className: 'App\\Two\\ExampleTest' });
    const index = indexTestCases([firstNamespace, secondNamespace]);

    assert.deepEqual(
      findIndexedMethodCases(index, '\\App.One.ExampleTest', 'testSame'),
      [firstNamespace],
      'a normalized exact class alias should not also match another class with the same suffix',
    );
    assert.deepEqual(
      findIndexedMethodCases(index, 'ExampleTest', 'testSame'),
      [firstNamespace, secondNamespace],
      'a short class name maps every candidate when the suffix is ambiguous',
    );
  });

  it('finds a dataset by its full case name when other methods use the same dataset label', () => {
    const firstMethodDataset = testCase({ name: 'testFirst with data set "shared"' });
    const secondMethodDataset = testCase({ name: 'testSecond with data set "shared"' });
    const index = indexTestCases([firstMethodDataset, secondMethodDataset]);

    assert.deepEqual(
      findIndexedDatasetCases(index, 'App\\Tests\\ExampleTest', secondMethodDataset.name),
      [secondMethodDataset],
    );
  });

  it('retains duplicate full dataset cases in report order', () => {
    const first = testCase({
      name: 'testFirst with data set "shared"',
      file: 'tests/FirstTest.php',
    });
    const repeated = testCase({
      name: 'testFirst with data set "shared"',
      file: 'tests/FirstTest.php',
      status: 'failed',
    });
    const index = indexTestCases([first, repeated], '/workspace');

    assert.deepEqual(
      findIndexedDatasetCases(index, 'App\\Tests\\ExampleTest', repeated.name),
      [first, repeated],
      'duplicate report entries remain available so callers can aggregate their outcomes',
    );
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

  it('deduplicates file results found through repeated class aliases', () => {
    const explicit = testCase({ file: 'tests/ExampleTest.php' });
    const withoutFile = testCase({ name: 'testWithoutFile' });
    const index = indexTestCases([explicit, withoutFile], '/workspace');

    assert.deepEqual(
      findIndexedFileCases(index, '/workspace/tests/ExampleTest.php', [
        'App\\Tests\\ExampleTest',
        'Tests.ExampleTest',
        'ExampleTest',
      ]),
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

  it('falls back to exact matching for Pest names shorter than one trigram', () => {
    const first = testCase({ name: 'ab case one' });
    const second = testCase({ name: 'ab case two' });
    const nonMatch = testCase({ name: 'ac case' });
    const index = indexTestCases([first, second, nonMatch], '/workspace');

    assert.deepEqual(
      findIndexedPestCases(index, 'ab', '/workspace/tests/PestTest.php'),
      [first, second],
    );
  });

  it('uses complete trigram postings for large no-file Pest result sets', () => {
    const cases = Array.from({ length: 180 }, (_, index) => testCase({
      name: `sample Pest test ${String(index).padStart(3, '0')}`,
    }));
    const index = indexTestCases(cases, '/workspace');
    const target = cases[37];

    assert.equal(index.withoutFileByTrigram.get('sam')?.length, cases.length);
    assert.deepEqual(findIndexedPestCases(index, target.name, '/workspace/tests/PestTest.php'), [target]);
  });

  it('falls back to exact substring matching when common Pest trigrams exceed the posting cap', () => {
    const cases = Array.from({ length: 1100 }, (_, index) => testCase({
      name: `case ${index} has shared Pest lookup text`,
    }));
    const index = indexTestCases(cases, '/workspace');
    const query = 'shared Pest lookup';
    const queryTrigrams = Array.from({ length: query.length - 2 }, (_, offset) => query.slice(offset, offset + 3));

    assert.ok(queryTrigrams.every((trigram) => !index.withoutFileByTrigram.has(trigram)));
    assert.deepEqual(findIndexedPestCases(index, query, '/workspace/tests/PestTest.php'), cases);
  });

  it('returns duplicate Pest names in the requested file and without file metadata only', () => {
    const firstLocal = testCase({ name: 'adds values with data set #0', file: 'tests/ValuesTest.php' });
    const secondLocal = testCase({ name: 'adds values with data set #0', file: 'tests/ValuesTest.php', className: 'Pest tests\\other' });
    const noFile = testCase({ name: 'adds values with data set #0', className: 'Pest tests\\missing' });
    const otherFile = testCase({ name: 'adds values with data set #0', file: 'tests/OtherTest.php' });
    const index = indexTestCases([firstLocal, secondLocal, noFile, otherFile], '/workspace');

    assert.deepEqual(
      findIndexedPestCases(index, 'adds values with data set #0', '/workspace/tests/ValuesTest.php'),
      [firstLocal, secondLocal, noFile],
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
