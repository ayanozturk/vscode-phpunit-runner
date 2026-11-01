import * as fs from 'fs/promises';
import * as path from 'path';
import { unmapWithMappings, type PathMapping } from './commandTemplate';

export type CoverageLineRange = { start: number; end: number };

export type TestFileCoverage = {
  /** Source file path relative to PHPUnit's `sourceRoot`, using `/` separators. */
  filePath: string;
  lines: CoverageLineRange[];
};

export type TestCoverage = {
  /** PHPUnit's exact test identifier, including a data-set suffix when present. */
  testId: string;
  files: TestFileCoverage[];
};

export type PHPUnitJsonlCoverage = {
  schemaVersion: 1;
  sourceRoot: string;
  tests: TestCoverage[];
};

export type MappedTestCoverageFile = {
  path: string;
  tests: Array<{ testId: string; lines: CoverageLineRange[] }>;
};

export type PhpUnitCoverageMethodCandidate = {
  itemId: string;
  workspacePath: string;
  className: string;
  methodName: string;
};

export type PhpUnitCoverageMethodMatcher = (testId: string, workspacePath: string) => string | undefined;

/** Limits this opt-in report to the Composer PHPUnit binary on a shared local filesystem. */
export function canRequestLocalPhpUnitJsonlCoverage(options: {
  workspacePath: string;
  phpunitExecutable: string;
  dockerEnabled: boolean;
  commandTemplate: string;
}): boolean {
  if (options.dockerEnabled || options.commandTemplate.trim()) {
    return false;
  }
  const executable = path.isAbsolute(options.phpunitExecutable)
    ? options.phpunitExecutable
    : path.resolve(options.workspacePath, options.phpunitExecutable);
  return path.resolve(executable) === path.resolve(options.workspacePath, 'vendor', 'bin', 'phpunit');
}

/** Returns true only for stable PHPUnit versions whose CLI supports JSONL coverage. */
export function supportsPhpUnitJsonlCoverage(version: string | undefined): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version?.trim() ?? '');
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 13 || (major === 13 && minor >= 4);
}

/** Reads a local JSONL report, keeping missing/malformed optional detail non-fatal. */
export async function readPhpUnitCoverageJsonl(directory: string): Promise<{
  report?: PHPUnitJsonlCoverage;
  warning?: string;
}> {
  try {
    const [meta, tests] = await Promise.all([
      fs.readFile(path.join(directory, 'meta.json'), 'utf8'),
      fs.readFile(path.join(directory, 'tests.jsonl'), 'utf8'),
    ]);
    return { report: parsePhpUnitCoverageJsonl(meta, tests) };
  } catch (error) {
    return { warning: `PHPUnit per-test coverage details are unavailable: ${String(error)}` };
  }
}

/** Maps report-relative file paths back to host paths and keeps exact test identifiers. */
export function mapPhpUnitCoverageFiles(
  report: PHPUnitJsonlCoverage,
  mappings: PathMapping[] = [],
): MappedTestCoverageFile[] {
  const byFile = new Map<string, Map<string, CoverageLineRange[]>>();
  for (const test of report.tests) {
    for (const file of test.files) {
      const absolutePath = path.resolve(report.sourceRoot, file.filePath);
      const hostPath = unmapWithMappings(absolutePath, mappings);
      const tests = byFile.get(hostPath) ?? new Map<string, CoverageLineRange[]>();
      const existingLines = tests.get(test.testId);
      tests.set(test.testId, existingLines ? mergeLineRanges(existingLines, file.lines) : file.lines);
      byFile.set(hostPath, tests);
    }
  }

  return [...byFile.entries()].map(([filePath, tests]) => ({
    path: filePath,
    tests: [...tests.entries()].map(([testId, lines]) => ({ testId, lines })),
  }));
}

/** Combines repeated report records without dropping earlier execution evidence. */
function mergeLineRanges(left: readonly CoverageLineRange[], right: readonly CoverageLineRange[]): CoverageLineRange[] {
  const sorted = [...left, ...right].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: CoverageLineRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end + 1) {
      merged.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }
  return merged;
}

/** Parses PHPUnit's exact class::method identifier; data-set IDs are intentionally left unmapped. */
export function parsePhpUnitCoverageTestMethodId(testId: string): { className: string; methodName: string } | undefined {
  const match = /^(.+?)::([A-Za-z_][A-Za-z0-9_]*)$/.exec(testId);
  return match ? { className: match[1], methodName: match[2] } : undefined;
}

/** Returns an item only when one exact class/method identity exists in that workspace. */
export function matchPhpUnitCoverageMethodItem(
  testId: string,
  workspacePath: string,
  candidates: readonly PhpUnitCoverageMethodCandidate[],
): string | undefined {
  return createPhpUnitCoverageMethodMatcher(candidates)(testId, workspacePath);
}

/** Builds a workspace-scoped identity index once for efficient report mapping. */
export function createPhpUnitCoverageMethodMatcher(
  candidates: readonly PhpUnitCoverageMethodCandidate[],
): PhpUnitCoverageMethodMatcher {
  const index = new Map<string, string[]>();
  for (const candidate of candidates) {
    const key = methodIdentityKey(candidate.workspacePath, candidate.className, candidate.methodName);
    const matches = index.get(key) ?? [];
    matches.push(candidate.itemId);
    index.set(key, matches);
  }

  return (testId, workspacePath) => {
    const identity = parsePhpUnitCoverageTestMethodId(testId);
    if (!identity) {
      return undefined;
    }
    const matching = index.get(methodIdentityKey(workspacePath, identity.className, identity.methodName));
    return matching?.length === 1 ? matching[0] : undefined;
  };
}

function methodIdentityKey(workspacePath: string, className: string, methodName: string): string {
  return `${path.resolve(workspacePath)}\0${normalizePhpUnitClassName(className)}\0${methodName.toLowerCase()}`;
}

function normalizePhpUnitClassName(value: string): string {
  return value.trim().replace(/^\\+/, '').toLowerCase();
}

/**
 * Parses PHPUnit 13.4+ JSONL coverage metadata and its per-test mapping.
 * Clover remains the cross-version aggregate fallback; this report is the
 * format that preserves which test executed which source lines.
 */
export function parsePhpUnitCoverageJsonl(metaText: string, testsText: string): PHPUnitJsonlCoverage {
  const metadata = parseMetadata(metaText);
  const tests: TestCoverage[] = [];

  for (const [index, line] of testsText.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`PHPUnit coverage tests.jsonl contains invalid JSON on line ${index + 1}.`);
    }

    const parsed = parseTestRecord(record);
    if (parsed) {
      tests.push(parsed);
    }
  }

  return { ...metadata, tests };
}

function parseMetadata(text: string): Pick<PHPUnitJsonlCoverage, 'schemaVersion' | 'sourceRoot'> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('PHPUnit coverage meta.json is not valid JSON.');
  }

  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.sourceRoot !== 'string' || !path.isAbsolute(value.sourceRoot)) {
    throw new Error('PHPUnit coverage meta.json must include schemaVersion 1 and an absolute sourceRoot.');
  }

  return { schemaVersion: 1, sourceRoot: value.sourceRoot };
}

function parseTestRecord(value: unknown): TestCoverage | undefined {
  if (!isRecord(value) || typeof value.test !== 'string' || !value.test.trim() || !isRecord(value.covers)) {
    return undefined;
  }

  const files: TestFileCoverage[] = [];
  for (const [filePath, rawRanges] of Object.entries(value.covers)) {
    if (!isSafeRelativePath(filePath) || !Array.isArray(rawRanges)) {
      continue;
    }
    const lines = rawRanges.map(parseLineRange).filter((range): range is CoverageLineRange => range !== undefined);
    if (lines.length > 0) {
      files.push({ filePath, lines });
    }
  }

  return files.length > 0 ? { testId: value.test, files } : undefined;
}

function parseLineRange(value: unknown): CoverageLineRange | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^(\d+)(?:-(\d+))?$/.exec(value);
  if (!match) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    return undefined;
  }
  return { start, end };
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes('\0') || value.startsWith('/') || value.includes('\\') || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
