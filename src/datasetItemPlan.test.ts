import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planDatasetItems } from './datasetItemPlan';
import type { JUnitTestCase } from './types';

const testCase = (name: string): JUnitTestCase => ({
  name,
  className: 'ExampleTest',
  timeSeconds: 0,
  status: 'passed',
  message: '',
});

describe('planDatasetItems', () => {
  it('plans report-order child IDs, labels, and inherited method metadata', () => {
    const first = testCase('testValues with data set "positive"');
    const second = testCase('testValues with data set #1');
    const plan = planDatasetItems('method-id', {
      uri: '/project/tests/ExampleTest.php',
      filePath: '/project/tests/ExampleTest.php',
      className: 'ExampleTest',
      methodName: 'testValues',
      groups: ['fast'],
    }, [first, testCase('anotherMethod'), second], []);

    assert.deepEqual(plan.items.map(({ id, label, testCase: itemCase, data }) => ({ id, label, testCase: itemCase, data })), [
      {
        id: 'method-id::dataset:with data set "positive"',
        label: '"positive"',
        testCase: first,
        data: {
          kind: 'dataset',
          uri: '/project/tests/ExampleTest.php',
          filePath: '/project/tests/ExampleTest.php',
          className: 'ExampleTest',
          methodName: 'testValues',
          datasetName: first.name,
          groups: ['fast'],
        },
      },
      {
        id: 'method-id::dataset:with data set #1',
        label: '#1',
        testCase: second,
        data: {
          kind: 'dataset',
          uri: '/project/tests/ExampleTest.php',
          filePath: '/project/tests/ExampleTest.php',
          className: 'ExampleTest',
          methodName: 'testValues',
          datasetName: second.name,
          groups: ['fast'],
        },
      },
    ]);
  });

  it('returns only stale dataset child IDs and handles methods without data sets', () => {
    const current = testCase('testValues with data set #0');
    const plan = planDatasetItems('method-id', {
      uri: '/project/tests/ExampleTest.php',
      methodName: 'testValues',
    }, [current], ['method-id::dataset:with data set #0', 'method-id::dataset:old']);

    assert.deepEqual(plan.items.map(({ id }) => id), ['method-id::dataset:with data set #0']);
    assert.deepEqual(plan.staleIds, ['method-id::dataset:old']);
    assert.deepEqual(planDatasetItems('empty-method', {
      uri: '/project/tests/ExampleTest.php', methodName: 'testEmpty',
    }, [], ['empty-method::dataset:old']), { items: [], staleIds: ['empty-method::dataset:old'] });
  });
});
