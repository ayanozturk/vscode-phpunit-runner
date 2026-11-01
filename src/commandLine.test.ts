import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitCommandLine } from './commandLine';

describe('splitCommandLine', () => {
  it('splits whitespace while preserving empty quoted arguments', () => {
    assert.deepEqual(splitCommandLine('phpunit  "" test.php'), ['phpunit', '', 'test.php']);
  });

  it('keeps whitespace inside single and double quotes', () => {
    assert.deepEqual(splitCommandLine(`phpunit --filter 'valid user' --testsuite "Feature Tests"`), [
      'phpunit', '--filter', 'valid user', '--testsuite', 'Feature Tests',
    ]);
  });

  it('joins adjacent quoted and unquoted fragments into the same argument', () => {
    assert.deepEqual(splitCommandLine(`--name="hello world"'!'`), ['--name=hello world!']);
  });

  it('unescapes supported quoted characters and retains a trailing backslash', () => {
    assert.deepEqual(splitCommandLine('one\\ two three\\'), ['one two', 'three\\']);
  });

  it('rejects unterminated quotes', () => {
    assert.throws(() => splitCommandLine(`phpunit --filter 'unfinished`), /unterminated quote/);
  });
});
