import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeSaxAttributes, readSaxAttribute } from './xmlAttributes';

describe('SAX XML attribute helpers', () => {
  it('reads string and object-valued attributes with case-insensitive names', () => {
    const attributes = {
      NAME: 'Unit',
      PREFIX: { name: 'PREFIX', value: 'Integration' },
    };

    assert.equal(readSaxAttribute(attributes, 'name'), 'Unit');
    assert.equal(readSaxAttribute(attributes, 'prefix'), 'Integration');
    assert.equal(readSaxAttribute(attributes, 'missing'), '');
  });

  it('normalizes names and string values while keeping the first case-insensitive match', () => {
    const normalized = normalizeSaxAttributes({
      Name: { name: 'Name', value: 'Unit' },
      NAME: 'ignored duplicate',
      PREFIX: 'Integration',
      INVALID: { name: 'INVALID', value: 1 },
    });

    assert.deepEqual(normalized, {
      name: 'Unit',
      prefix: 'Integration',
      invalid: '',
    });
  });
});
