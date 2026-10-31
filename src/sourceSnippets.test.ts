import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { sourceSnippetKey } from './outputFormatter';
import { readFailureSourceSnippets } from './sourceSnippets';
import type { JUnitTestCase } from './types';

function failure(file: string, line: number): JUnitTestCase {
  return {
    name: 'testFailure',
    className: 'ExampleTest',
    timeSeconds: 0,
    status: 'failed',
    message: '',
    file,
    line,
  };
}

describe('readFailureSourceSnippets', () => {
  it('reads distinct files concurrently and reuses each file for unique failure locations', async () => {
    const workspace = path.join(path.sep, 'workspace');
    const one = path.join(workspace, 'One.php');
    const two = path.join(workspace, 'Two.php');
    const reads: string[] = [];
    let activeReads = 0;
    let maximumConcurrentReads = 0;
    const snippets = await readFailureSourceSnippets([
      failure('One.php', 1),
      failure('One.php', 2),
      failure('One.php', 2),
      failure('Two.php', 1),
    ], workspace, async (filePath) => {
      reads.push(filePath);
      activeReads += 1;
      maximumConcurrentReads = Math.max(maximumConcurrentReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeReads -= 1;
      return filePath === one ? 'one\nsecond line' : 'two';
    });

    assert.deepEqual(reads.sort(), [one, two].sort());
    assert.equal(maximumConcurrentReads, 2);
    assert.equal(snippets.size, 3);
    assert.match(snippets.get(sourceSnippetKey('One.php', 1)) ?? '', /one/);
    assert.match(snippets.get(sourceSnippetKey('One.php', 2)) ?? '', /second line/);
    assert.match(snippets.get(sourceSnippetKey('Two.php', 1)) ?? '', /two/);
  });

  it('supports zero, default, and maximum source context lines', async () => {
    const sourceFile = path.join(path.sep, 'workspace', 'Context.php');
    const source = Array.from({ length: 11 }, (_, index) => `line ${index + 1}`).join('\n');
    const readSourceFile = async () => source;
    const key = sourceSnippetKey(sourceFile, 6);

    const noContext = await readFailureSourceSnippets([failure(sourceFile, 6)], undefined, readSourceFile, 0);
    assert.equal(stripAnsi(noContext.get(key) ?? ''), '  > 6 | line 6');

    const defaultContext = await readFailureSourceSnippets([failure(sourceFile, 6)], undefined, readSourceFile);
    const defaultLines = stripAnsi(defaultContext.get(key) ?? '').split('\n');
    assert.equal(defaultLines.length, 3);
    assert.match(defaultLines[0], /line 5$/);
    assert.match(defaultLines[1], /> 6 \| line 6$/);
    assert.match(defaultLines[2], /line 7$/);

    const maximumContext = await readFailureSourceSnippets([failure(sourceFile, 6)], undefined, readSourceFile, 5);
    const maximumLines = stripAnsi(maximumContext.get(key) ?? '').split('\n');
    assert.equal(maximumLines.length, 11);
    assert.match(maximumLines[0], /line 1$/);
    assert.match(maximumLines[5], />\s+6 \| line 6$/);
    assert.match(maximumLines[10], /line 11$/);
  });

  it('limits simultaneous reads when a run has many distinct failure files', async () => {
    const cases = Array.from({ length: 40 }, (_, index) => failure(
      path.join(path.sep, 'workspace', `Failure${index}.php`),
      1,
    ));
    let activeReads = 0;
    let maximumConcurrentReads = 0;
    const snippets = await readFailureSourceSnippets(cases, undefined, async () => {
      activeReads += 1;
      maximumConcurrentReads = Math.max(maximumConcurrentReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeReads -= 1;
      return 'failure line';
    });

    assert.ok(maximumConcurrentReads > 1, 'distinct files are read in parallel');
    assert.ok(maximumConcurrentReads <= 16, `observed ${maximumConcurrentReads} simultaneous reads`);
    assert.equal(snippets.size, 40);
  });

  it('keeps readable snippets when another failure file cannot be read', async () => {
    const snippets = await readFailureSourceSnippets([
      failure('/remote/container/Missing.php', 1),
      failure('/workspace/Readable.php', 2),
    ], undefined, async (filePath) => {
      if (filePath.includes('Missing.php')) {
        throw new Error('remote file is not mounted locally');
      }
      return 'first\nreadable line';
    });

    assert.equal(snippets.size, 1);
    assert.match(snippets.get(sourceSnippetKey('/workspace/Readable.php', 2)) ?? '', /readable line/);
  });

  it('skips relative failure paths when no workspace root is available', async () => {
    let readCount = 0;
    const snippets = await readFailureSourceSnippets([failure('tests/ExampleTest.php', 1)], undefined, async () => {
      readCount += 1;
      return 'unreachable';
    });

    assert.equal(readCount, 0);
    assert.equal(snippets.size, 0);
  });
});

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}
