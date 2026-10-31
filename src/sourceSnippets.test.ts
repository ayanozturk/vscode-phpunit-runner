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
