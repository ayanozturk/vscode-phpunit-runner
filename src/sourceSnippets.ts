import * as fs from 'fs/promises';
import * as path from 'path';
import { firstFailureLocation } from './junit';
import { sourceSnippetAtLine, sourceSnippetKey } from './outputFormatter';
import type { JUnitTestCase } from './types';

export type ReadSourceFile = (filePath: string) => Promise<string>;

type SnippetRequest = {
  sourceFile: string;
  sourceLine: number;
  filePath: string;
};

const MAX_CONCURRENT_SOURCE_READS = 16;

export async function readFailureSourceSnippets(
  cases: JUnitTestCase[],
  workspacePath?: string,
  readSourceFile: ReadSourceFile = (filePath) => fs.readFile(filePath, 'utf8'),
): Promise<Map<string, string>> {
  const requests = new Map<string, SnippetRequest>();

  for (const testCase of cases) {
    if (testCase.status !== 'failed' && testCase.status !== 'errored') {
      continue;
    }

    const location = firstFailureLocation([testCase]);
    const sourceFile = location.file ?? testCase.file;
    const sourceLine = location.line ?? testCase.line;
    if (!sourceFile || !sourceLine || sourceLine < 1) {
      continue;
    }

    const filePath = path.isAbsolute(sourceFile)
      ? sourceFile
      : workspacePath ? path.resolve(workspacePath, sourceFile) : undefined;
    if (!filePath) {
      continue;
    }

    const key = sourceSnippetKey(sourceFile, sourceLine);
    if (!requests.has(key)) {
      requests.set(key, { sourceFile, sourceLine, filePath });
    }
  }

  const filePaths = new Set([...requests.values()].map(({ filePath }) => filePath));
  const contentsByPath = new Map<string, string | undefined>();
  const distinctFilePaths = [...filePaths];
  let nextFilePath = 0;
  const workerCount = Math.min(MAX_CONCURRENT_SOURCE_READS, distinctFilePaths.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextFilePath < distinctFilePaths.length) {
      const filePath = distinctFilePaths[nextFilePath++];
      contentsByPath.set(filePath, await readSourceFile(filePath).catch(() => undefined));
    }
  }));

  const snippets = new Map<string, string>();
  for (const [key, { filePath, sourceLine }] of requests) {
    const contents = contentsByPath.get(filePath);
    if (!contents) {
      continue;
    }

    const snippet = sourceSnippetAtLine(contents, sourceLine);
    if (snippet) {
      snippets.set(key, snippet);
    }
  }

  return snippets;
}
