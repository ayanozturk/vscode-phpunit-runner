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

  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.sourceRoot !== 'string' || !value.sourceRoot.trim()) {
    throw new Error('PHPUnit coverage meta.json must include schemaVersion 1 and a non-empty sourceRoot.');
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
  if (!value || value.startsWith('/') || value.includes('\\') || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
