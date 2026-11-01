import * as fs from 'fs/promises';
import * as path from 'path';
import { firstFailureLocation } from './junit';
import { sourceSnippetAtLineFromLines, sourceSnippetKey } from './outputFormatter';
import type { JUnitTestCase } from './types';

export type ReadSourceFile = (filePath: string) => Promise<string>;

type SnippetRequest = {
  sourceFile: string;
  sourceLine: number;
  filePath: string;
};

const MAX_CONCURRENT_SOURCE_READS = 16;
const DEFAULT_SOURCE_SNIPPET_CONTEXT_LINES = 1;
const MAX_SOURCE_SNIPPET_CONTEXT_LINES = 5;

export async function readFailureSourceSnippets(
  cases: JUnitTestCase[],
  workspacePath?: string,
  readSourceFile: ReadSourceFile = (filePath) => fs.readFile(filePath, 'utf8'),
  contextLines = DEFAULT_SOURCE_SNIPPET_CONTEXT_LINES,
): Promise<Map<string, string>> {
  const requests = new Map<string, SnippetRequest>();
  const distinctFilePaths = new Set<string>();
  const filePathsToRead: string[] = [];

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
      if (!distinctFilePaths.has(filePath)) {
        distinctFilePaths.add(filePath);
        filePathsToRead.push(filePath);
      }
    }
  }

  const contentsByPath = new Map<string, string | undefined>();
  let nextFilePath = 0;
  const workerCount = Math.min(MAX_CONCURRENT_SOURCE_READS, filePathsToRead.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextFilePath < filePathsToRead.length) {
      const filePath = filePathsToRead[nextFilePath++];
      contentsByPath.set(filePath, await readSourceFile(filePath).catch(() => undefined));
    }
  }));

  const snippets = new Map<string, string>();
  const linesByPath = new Map<string, string[]>();
  const snippetContextLines = Number.isFinite(contextLines)
    ? Math.min(MAX_SOURCE_SNIPPET_CONTEXT_LINES, Math.max(0, Math.trunc(contextLines)))
    : DEFAULT_SOURCE_SNIPPET_CONTEXT_LINES;
  for (const [key, { filePath, sourceLine }] of requests) {
    const contents = contentsByPath.get(filePath);
    if (!contents) {
      continue;
    }

    let lines = linesByPath.get(filePath);
    if (!lines) {
      lines = contents.split(/\r?\n/);
      linesByPath.set(filePath, lines);
    }
    const snippet = sourceSnippetAtLineFromLines(lines, sourceLine, snippetContextLines);
    if (snippet) {
      snippets.set(key, snippet);
    }
  }

  return snippets;
}
