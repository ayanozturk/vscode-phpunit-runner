import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexTestCases } from './resultIndex';
import { planMethodResult } from './methodResultPlan';
import type { JUnitTestCase } from './types';

const testCase = (name: string, overrides: Partial<JUnitTestCase> = {}): JUnitTestCase => ({
  name,
  className: 'ExampleTest',
  timeSeconds: 0.125,
  status: 'passed',
  message: '',
  ...overrides,
});

describe('planMethodResult', () => {
  it('selects all report cases for a method and sums their duration', () => {
    const cases = [testCase('testWorks', { timeSeconds: 0.125 }), testCase('testWorks with data set #0', { timeSeconds: 0.4 })];
    const plan = planMethodResult(indexTestCases(cases), {
      kind: 'method', className: 'ExampleTest', methodName: 'testWorks',
    });

    assert.deepEqual(plan.cases, cases);
    assert.equal(plan.status, 'passed');
    assert.equal(plan.duration, 525);
  });

  it('selects only the named dataset', () => {
    const first = testCase('testWorks with data set "valid"');
    const second = testCase('testWorks with data set "invalid"');
    const plan = planMethodResult(indexTestCases([first, second]), {
      kind: 'dataset', className: 'ExampleTest', methodName: 'testWorks', datasetName: 'testWorks with data set "invalid"',
    });

    assert.deepEqual(plan.cases, [second]);
  });

  it('selects Pest cases by name and source file', () => {
    const sameNameOtherFile = testCase('it works', { file: '/project/OtherTest.php' });
    const expected = testCase('it works', { file: '/project/FeatureTest.php' });
    const plan = planMethodResult(indexTestCases([sameNameOtherFile, expected]), {
      kind: 'method', pestTestName: 'it works', filePath: '/project/FeatureTest.php',
    });

    assert.deepEqual(plan.cases, [expected]);
  });

  it('aggregates failures and skipped reports', () => {
    const failed = planMethodResult(indexTestCases([
      testCase('testWorks', { status: 'failed' }),
    ]), { kind: 'method', className: 'ExampleTest', methodName: 'testWorks' });
    const skipped = planMethodResult(indexTestCases([
      testCase('testWorks', { status: 'skipped' }),
    ]), { kind: 'method', className: 'ExampleTest', methodName: 'testWorks' });

    assert.equal(failed.status, 'failed');
    assert.equal(skipped.status, 'skipped');
  });
});
