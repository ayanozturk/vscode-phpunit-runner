import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTargetFilter, withoutParallelOverrides } from './testSelectionArguments';
import type { TestTarget } from './types';

describe('buildTargetFilter', () => {
  it('targets PHPUnit methods and retains their data-provider cases', () => {
    assert.equal(buildTargetFilter({ kind: 'method', className: 'App\\Tests\\UserTest', methodName: 'testCanLogin' }),
      '~^App\\\\Tests\\\\UserTest::testCanLogin(?: with data set .*)?$~i');
  });

  it('targets an exact PHPUnit data set and escapes regex and delimiter characters', () => {
    assert.equal(buildTargetFilter({
      kind: 'dataset', className: 'ExampleTest', datasetName: 'testRows with data set "blue+~[1]"',
    }), '~^ExampleTest::testRows with data set "blue\\+\\~\\[1\\]"$~i');
  });

  it('supports Pest cases and class-only selections', () => {
    assert.equal(buildTargetFilter({ kind: 'method', pestTestName: 'adds values [1]' }), '~adds values \\[1\\]~i');
    assert.equal(buildTargetFilter({ kind: 'class', className: 'ExampleTest' }), '~^ExampleTest(?:::.*)?$~i');
  });

  it('omits a filter when a target has no executable identity', () => {
    assert.equal(buildTargetFilter({ kind: 'file', filePath: '/workspace/tests/Unknown.php' }), undefined);
  });
});

describe('withoutParallelOverrides', () => {
  it('removes separated and inline parallel options without changing other arguments', () => {
    const args = ['--processes', '4', '--parallel', '--processes=8', '--testdox', 'suite'];
    assert.deepEqual(withoutParallelOverrides(args), ['--testdox', 'suite']);
    assert.deepEqual(args, ['--processes', '4', '--parallel', '--processes=8', '--testdox', 'suite']);
  });

  it('keeps following flags when a parallel process count is missing', () => {
    assert.deepEqual(withoutParallelOverrides(['--processes', '--testdox']), ['--testdox']);
  });
});
