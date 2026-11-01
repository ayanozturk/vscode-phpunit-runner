import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { maskPhpNonCode } from './phpSourceMask';

describe('maskPhpNonCode', () => {
  it('masks comments and quoted text while preserving code and source offsets', () => {
    const source = `<?php // function fakeFromLineComment() {}
# function fakeFromHashComment() {}
/* function fakeFromBlockComment() {} */
$text = 'function fakeFromString() {}';
#[Test]
function testReal() {}`;
    const masked = maskPhpNonCode(source);

    assert.equal(masked.length, source.length);
    assert.equal(masked.replace(/[^\r\n]/g, '').length, source.replace(/[^\r\n]/g, '').length);
    assert.match(masked, /#\[Test\]/);
    assert.match(masked, /function testReal\(\)/);
    for (const fake of ['fakeFromLineComment', 'fakeFromHashComment', 'fakeFromBlockComment', 'fakeFromString']) {
      assert.ok(!masked.includes(fake), `${fake} is masked`);
    }
  });

  it('masks heredoc contents and its terminator but keeps following declarations', () => {
    const source = `<?php
$value = <<<TEXT
function fakeFromHeredoc() {}
TEXT;
function testAfterHeredoc() {}`;
    const masked = maskPhpNonCode(source);

    assert.equal(masked.length, source.length);
    assert.ok(!masked.includes('fakeFromHeredoc'));
    assert.match(masked, /function testAfterHeredoc\(\)/);
  });

  it('masks escaped quotes without resuming inside a string', () => {
    const source = `<?php $value = "escaped \\\" function fake() {}"; function testReal() {}`;
    const masked = maskPhpNonCode(source);

    assert.ok(!masked.includes('function fake'));
    assert.match(masked, /function testReal\(\)/);
  });
});
