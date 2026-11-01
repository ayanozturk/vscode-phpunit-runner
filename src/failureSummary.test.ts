import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeFailureMessage } from './failureSummary';

describe('normalizeFailureMessage', () => {
  it('keeps the first non-empty line and strips terminal styling and control characters', () => {
    assert.equal(
      normalizeFailureMessage('\n\u001b[31mExpected\u001b[0m\u0000 2, got 1\nstack trace'),
      'Expected 2, got 1',
    );
  });

  it('collapses whitespace and truncates summaries to 200 characters', () => {
    assert.equal(normalizeFailureMessage('  expected\tvalue  '), 'expected value');
    assert.equal(normalizeFailureMessage('x'.repeat(201)), `${'x'.repeat(199)}…`);
    assert.equal(normalizeFailureMessage(''), '');
  });
});
