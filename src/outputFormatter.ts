import type { JUnitTestCase, JUnitStatus } from './types';
import { firstFailureLocation } from './junit';

export type OutputPreset = 'collision' | 'progress' | 'pretty' | 'summary';
export type TestOutputFormat = {
  colors?: boolean;
  duration?: boolean;
  icons?: Partial<Record<JUnitStatus, string>>;
  testCase?: string;
  failureLocation?: string;
  failureMessage?: string;
  sourceSnippet?: boolean;
};

export type TestOutputSegment = {
  text: string;
  location?: { file: string; line: number };
};

export function sourceSnippetKey(file: string, line: number): string {
  return `${file}:${line}`;
}

export function sourceSnippetAtLine(source: string, line: number, contextLines = 1): string | undefined {
  if (source.length === 0) {
    return undefined;
  }

  return sourceSnippetAtLineFromLines(source.split(/\r?\n/), line, contextLines);
}

export function sourceSnippetAtLineFromLines(
  lines: readonly string[],
  line: number,
  contextLines = 1,
): string | undefined {
  if (line < 1 || line > lines.length) {
    return undefined;
  }

  const startLine = Math.max(1, line - Math.max(0, contextLines));
  const endLine = Math.min(lines.length, line + Math.max(0, contextLines));
  const lineNumberWidth = String(endLine).length;
  return lines.slice(startLine - 1, endLine).map((text, index) => {
    const number = startLine + index;
    const marker = number === line ? '>' : ' ';
    const rendered = `  ${marker} ${String(number).padStart(lineNumberWidth)} | ${text}`;
    return number === line ? `${ANSI.red}${rendered}${ANSI.reset}` : rendered;
  }).join('\n');
}

export function formatTestOutput(
  cases: JUnitTestCase[],
  preset: OutputPreset,
  fallbackOutput = '',
  sourceSnippets: ReadonlyMap<string, string> = new Map(),
  format: TestOutputFormat = {},
): string {
  return formatTestOutputSegments(cases, preset, fallbackOutput, sourceSnippets, format)
    .map((segment) => segment.text)
    .join('');
}

export function formatTestOutputSegments(
  cases: JUnitTestCase[],
  preset: OutputPreset,
  fallbackOutput = '',
  sourceSnippets: ReadonlyMap<string, string> = new Map(),
  format: TestOutputFormat = {},
): TestOutputSegment[] {
  if (cases.length === 0) {
    const text = ensureTrailingNewline(fallbackOutput);
    return text ? [{ text }] : [];
  }

  switch (preset) {
    case 'progress':
      return [{ text: formatProgress(cases, format) }];
    case 'summary':
      return formatSummarySegments(cases, format);
    case 'pretty':
      return formatPrettySegments(cases, sourceSnippets, format);
    case 'collision':
    default:
      return formatCollisionSegments(cases, sourceSnippets, format);
  }
}

function formatSummarySegments(cases: JUnitTestCase[], format: TestOutputFormat): TestOutputSegment[] {
  const { counts, failedCases } = tallyOutcomes(cases);
  const testCount = cases.length === 1 ? '1 test' : `${cases.length} tests`;
  const errorCount = counts.errored === 1 ? '1 error' : `${counts.errored} errors`;
  const segments: TestOutputSegment[] = [{
    text: `${testCount}: ${counts.passed} passed, ${counts.failed} failed, ${errorCount}, ${counts.skipped} skipped\n`,
  }];

  for (const testCase of failedCases) {
    const failureLocation = firstFailureLocation([testCase]);
    const file = failureLocation.file ?? testCase.file;
    const line = failureLocation.line ?? testCase.line;
    const location = formatFailureLocation(file, line, format);
    const message = formatFailureMessage(testCase.message, format)?.split(/\r?\n/, 1)[0];
    const lines = [formatTestCaseLine(testCase, statusLabel(testCase.status), {
      ...format,
      duration: false,
    })];
    if (location) {
      lines.push(location);
    }
    if (message) {
      lines.push(message);
    }

    segments.push({
      text: `${lines.join('\n')}\n`,
      ...(format.failureLocation !== '' && file && line ? { location: { file, line } } : {}),
    });
  }

  return segments;
}

function formatCollisionSegments(
  cases: JUnitTestCase[],
  sourceSnippets: ReadonlyMap<string, string>,
  format: TestOutputFormat,
): TestOutputSegment[] {
  return cases.map((testCase) => {
    const details = formatCaseDetails(testCase, sourceSnippets, format, false);
    const lines = [
      formatTestCaseLine(testCase, statusGlyph(testCase.status), format),
      ...(details.location ? [details.location] : []),
      ...(details.snippet && format.sourceSnippet !== false ? [formatSnippet(details.snippet, format)] : []),
      ...(details.message ? [details.message] : []),
    ];
    return {
      text: `${lines.join('\n')}\n`,
      ...(details.location && details.file && details.line
        ? { location: { file: details.file, line: details.line } }
        : {}),
    };
  });
}

function formatProgress(cases: JUnitTestCase[], format: TestOutputFormat): string {
  const { counts } = tallyOutcomes(cases);
  const indicators = cases.map((testCase) => colorStatusGlyph(
    format.icons?.[testCase.status] ?? progressGlyph(testCase.status),
    testCase.status,
    format.colors !== false,
  )).join('');
  return `${indicators}\n${cases.length} tests: ${counts.passed} passed, ${counts.failed} failed, ${counts.errored} errors, ${counts.skipped} skipped\n`;
}

function formatPrettySegments(
  cases: JUnitTestCase[],
  sourceSnippets: ReadonlyMap<string, string>,
  format: TestOutputFormat,
): TestOutputSegment[] {
  return cases.map((testCase) => {
    const result = format.testCase
      ? formatTestCaseLine(testCase, statusLabel(testCase.status), format)
      : `${colorStatusLabel(statusLabel(testCase.status), testCase.status, format.colors !== false)} ${testCase.name}${format.duration === false ? '' : formatDuration(testCase.timeSeconds)}`;
    const details = formatCaseDetails(testCase, sourceSnippets, format, true);
    const lines = [
      result,
      ...(details.location ? [details.location] : []),
      ...(details.snippet && format.sourceSnippet !== false ? [formatSnippet(details.snippet, format)] : []),
      ...(details.message ? [details.message] : []),
    ];
    return {
      text: `${lines.join('\n')}\n`,
      ...(details.location && details.file && details.line
        ? { location: { file: details.file, line: details.line } }
        : {}),
    };
  });
}

function formatCaseDetails(
  testCase: JUnitTestCase,
  sourceSnippets: ReadonlyMap<string, string>,
  format: TestOutputFormat,
  includeNonFailureMessage: boolean,
): { file?: string; line?: number; location?: string; snippet?: string; message?: string } {
  const failure = isFailure(testCase.status);
  const failureLocation = failure ? firstFailureLocation([testCase]) : {};
  const file = failureLocation.file ?? testCase.file;
  const line = failureLocation.line ?? testCase.line;
  return {
    file,
    line,
    location: failure ? formatFailureLocation(file, line, format) : undefined,
    snippet: failure && file && line ? sourceSnippets.get(sourceSnippetKey(file, line)) : undefined,
    message: failure || includeNonFailureMessage ? formatFailureMessage(testCase.message, format) : undefined,
  };
}

function formatTestCaseLine(testCase: JUnitTestCase, defaultStatus: string, format: TestOutputFormat): string {
  const duration = format.duration === false ? '' : formatDuration(testCase.timeSeconds);
  const icon = format.icons?.[testCase.status] ?? statusGlyph(testCase.status);
  if (format.testCase) {
    return renderTemplate(format.testCase, {
      status: colorStatusLabel(statusLabel(testCase.status), testCase.status, format.colors !== false),
      icon: colorStatusGlyph(icon, testCase.status, format.colors !== false),
      name: testCase.name,
      duration: duration.trim().replace(/^\(|\)$/g, ''),
    });
  }
  return `${colorStatusGlyph(defaultStatus, testCase.status, format.colors !== false)} ${testCase.name}${duration}`;
}

function formatFailureLocation(file: string | undefined, line: number | undefined, format: TestOutputFormat): string | undefined {
  if (format.failureLocation === '') {
    return undefined;
  }
  if (!file || !line) {
    return undefined;
  }
  return format.failureLocation
    ? renderTemplate(format.failureLocation, { file, line: String(line) })
    : `  ${file}:${line}`;
}

function formatFailureMessage(message: string | undefined, format: TestOutputFormat): string | undefined {
  if (!message || format.failureMessage === '') {
    return undefined;
  }
  const normalizedMessage = format.colors === false ? stripAnsiColors(message) : message;
  return format.failureMessage
    ? renderTemplate(format.failureMessage, { message: normalizedMessage })
    : indent(normalizedMessage, '  ');
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(status|icon|name|duration|file|line|message)\}/g, (_, key: string) => values[key] ?? '');
}

function formatSnippet(snippet: string, format: TestOutputFormat): string {
  return format.colors === false ? stripAnsiColors(snippet) : snippet;
}

function stripAnsiColors(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*m/g, '');
}

function ensureTrailingNewline(output: string): string {
  if (!output || output.endsWith('\n')) {
    return output;
  }
  return `${output}\n`;
}

function indent(value: string, prefix: string): string {
  return value.split(/\r?\n/).map((line) => `${prefix}${line}`).join('\n');
}

function formatDuration(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  return ` (${milliseconds} ms)`;
}

function statusGlyph(status: JUnitStatus): string {
  switch (status) {
    case 'passed': return '✓';
    case 'failed': return '✗';
    case 'errored': return '!';
    case 'skipped': return '–';
  }
}

function progressGlyph(status: JUnitStatus): string {
  switch (status) {
    case 'passed': return '.';
    case 'failed': return 'F';
    case 'errored': return 'E';
    case 'skipped': return 'S';
  }
}

function statusLabel(status: JUnitStatus): string {
  switch (status) {
    case 'passed': return 'PASS';
    case 'failed': return 'FAIL';
    case 'errored': return 'ERROR';
    case 'skipped': return 'SKIP';
  }
}

function isFailure(status: JUnitStatus): boolean {
  return status === 'failed' || status === 'errored';
}

function tallyOutcomes(cases: JUnitTestCase[]): {
  counts: Record<JUnitStatus, number>;
  failedCases: JUnitTestCase[];
} {
  const counts: Record<JUnitStatus, number> = {
    passed: 0,
    failed: 0,
    errored: 0,
    skipped: 0,
  };
  const failedCases: JUnitTestCase[] = [];

  for (const testCase of cases) {
    counts[testCase.status] += 1;
    if (isFailure(testCase.status)) {
      failedCases.push(testCase);
    }
  }

  return { counts, failedCases };
}

const ANSI = {
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  dim: '\u001b[2m',
  reset: '\u001b[0m',
} as const;

function colorStatusGlyph(value: string, status: JUnitStatus, colors = true): string {
  return colors ? `${statusColor(status)}${value}${ANSI.reset}` : value;
}

function colorStatusLabel(value: string, status: JUnitStatus, colors = true): string {
  return colors ? `${statusColor(status)}${value}${ANSI.reset}` : value;
}

function statusColor(status: JUnitStatus): string {
  switch (status) {
    case 'passed': return ANSI.green;
    case 'failed':
    case 'errored': return ANSI.red;
    case 'skipped': return ANSI.yellow;
  }
}
