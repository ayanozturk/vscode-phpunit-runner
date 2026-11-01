import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findInsightTarget, parseInsightTestIdentity } from './insightIdentity';
import type { TestTarget } from './types';

describe('persisted test insight identity', () => {
  it('parses workspace, class, method, and named data set components', () => {
    assert.deepEqual(
      parseInsightTestIdentity('file:///workspace::App\\Tests\\UserTest::testCreates with data set "admin"', 'file:///workspace'),
      {
        className: 'App\\Tests\\UserTest',
        caseName: 'testCreates with data set "admin"',
        methodName: 'testCreates',
        datasetSuffix: 'with data set "admin"',
      },
    );
  });

  it('rejects malformed identities and identities from a different workspace', () => {
    assert.equal(parseInsightTestIdentity('missing-separator'), undefined);
    assert.equal(parseInsightTestIdentity('::testMethod'), undefined);
    assert.equal(parseInsightTestIdentity('file:///other::UserTest::testMethod', 'file:///workspace'), undefined);
  });

  it('matches a method by class and method while ignoring a namespace prefix difference', () => {
    const method: TestTarget = {
      kind: 'method',
      className: 'App\\Tests\\UserTest',
      methodName: 'testCreates',
    };
    assert.equal(
      findInsightTarget('file:///workspace::UserTest::testCreates', [method], 'file:///workspace'),
      method,
    );
  });

  it('prefers an exact named data set and falls back to its method when the row is unavailable', () => {
    const method: TestTarget = {
      kind: 'method',
      className: 'UserTest',
      methodName: 'testCreates',
    };
    const dataSet: TestTarget = {
      kind: 'dataset',
      className: 'UserTest',
      methodName: 'testCreates',
      datasetName: 'testCreates with data set "admin"',
    };
    const identity = 'file:///workspace::UserTest::testCreates with data set "admin"';
    assert.equal(findInsightTarget(identity, [method, dataSet], 'file:///workspace'), dataSet);
    assert.equal(findInsightTarget(identity, [method], 'file:///workspace'), method);
  });

  it('maps numeric provider rows and Pest dataset metadata when available', () => {
    const phpunitRow: TestTarget = {
      kind: 'dataset',
      className: 'RowsTest',
      methodName: 'testRows',
      datasetName: 'testRows with data set #2',
    };
    assert.equal(
      findInsightTarget('file:///workspace::RowsTest::testRows with data set #2', [phpunitRow], 'file:///workspace'),
      phpunitRow,
    );

    const pestRow: TestTarget = {
      kind: 'method',
      className: 'Pest\\Tests\\FeatureTest',
      methodName: 'testFeature',
      pestTestName: 'testFeature',
      pestDatasetName: 'signed-in',
    };
    assert.equal(
      findInsightTarget(
        'file:///workspace::FeatureTest::testFeature with data set "signed-in"',
        [pestRow],
        'file:///workspace',
      ),
      pestRow,
    );
  });
});
