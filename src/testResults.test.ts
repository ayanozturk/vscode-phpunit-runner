import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executionDisposition, unverifiedJUnitMessage } from './testResults';

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

  it('gives cancellation precedence over the process exit and report', () => {
    assert.equal(executionDisposition({ cancelled: true, exitCode: 143, caseCount: 2 }), 'cancelled');
    assert.equal(executionDisposition({ cancelled: false, exitCode: 0, caseCount: 0 }), 'unverified');
    assert.equal(executionDisposition({ exitCode: 1, caseCount: 0 }), 'reported');
  });
});
