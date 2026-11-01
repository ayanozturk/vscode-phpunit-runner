import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTestOutputFormat } from './outputFormatConfig';

describe('parseTestOutputFormat', () => {
  it('keeps supported values and filters malformed icon overrides', () => {
    assert.deepEqual(parseTestOutputFormat({
      colors: false,
      duration: true,
      icons: { passed: 'OK', failed: 'NO', errored: 1, unknown: '??' },
      testCase: '[{status}] {class}::{name}',
      failureLocation: '',
      failureMessage: '{message}',
      sourceSnippet: false,
      unknown: 'ignored',
    }), {
      colors: false,
      duration: true,
      icons: { passed: 'OK', failed: 'NO' },
      testCase: '[{status}] {class}::{name}',
      failureLocation: '',
      failureMessage: '{message}',
      sourceSnippet: false,
    });
  });

  it('ignores non-object settings and non-string values', () => {
    assert.deepEqual(parseTestOutputFormat(null), {});
    assert.deepEqual(parseTestOutputFormat([]), {});
    assert.deepEqual(parseTestOutputFormat({ colors: 'false', duration: 0, icons: [], testCase: 4 }), {
      colors: undefined,
      duration: undefined,
      icons: undefined,
      testCase: undefined,
      failureLocation: undefined,
      failureMessage: undefined,
      sourceSnippet: undefined,
    });
  });
});
