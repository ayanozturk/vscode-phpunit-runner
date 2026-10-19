import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unverifiedJUnitMessage } from './testResults';

describe('unverified PHPUnit results', () => {
  it('does not treat a successful run without cases as a pass', () => {
    assert.equal(
      unverifiedJUnitMessage(0),
      'PHPUnit exited without readable JUnit test cases; test results are unverified.',
    );
  });

  it('uses the remote report warning when detailed results are unavailable', () => {
    assert.equal(unverifiedJUnitMessage(0, 'Remote JUnit report unavailable.'), 'Remote JUnit report unavailable.');
  });

  it('leaves failing process handling to the failure path', () => {
    assert.equal(unverifiedJUnitMessage(1, 'Remote JUnit report unavailable.'), undefined);
  });
});
