import type { JUnitTestCase, JUnitStatus } from './types';
import { firstFailureLocation } from './junit';

export type OutputPreset = 'collision' | 'progress' | 'pretty';
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
  const lines = source.split(/\r?\n/);
  if (source.length === 0 || line < 1 || line > lines.length) {
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
    case 'pretty':
      return formatPrettySegments(cases, sourceSnippets, format);
    case 'collision':
    default:
      return formatCollisionSegments(cases, sourceSnippets, format);
  }
}

function formatCollisionSegments(
  cases: JUnitTestCase[],
  sourceSnippets: ReadonlyMap<string, string>,
  format: TestOutputFormat,
): TestOutputSegment[] {
  return cases.map((testCase) => {
    const failureLocation = isFailure(testCase.status) ? firstFailureLocation([testCase]) : {};
    const file = failureLocation.file ?? testCase.file;
    const line = failureLocation.line ?? testCase.line;
    const location = isFailure(testCase.status) ? formatFailureLocation(file, line, format) : undefined;
    const message = isFailure(testCase.status) ? formatFailureMessage(testCase.message, format) : undefined;
    const snippet = isFailure(testCase.status) && file && line
      ? sourceSnippets.get(sourceSnippetKey(file, line))
      : undefined;
    const lines = [
      formatTestCaseLine(testCase, statusGlyph(testCase.status), format),
      ...(location ? [location] : []),
      ...(snippet && format.sourceSnippet !== false ? [formatSnippet(snippet, format)] : []),
      ...(message ? [message] : []),
    ];
    return {
      text: `${lines.join('\n')}\n`,
      ...(location && file && line ? { location: { file, line } } : {}),
    };
  });
}

function formatProgress(cases: JUnitTestCase[], format: TestOutputFormat): string {
  const indicators = cases.map((testCase) => colorStatusGlyph(
    format.icons?.[testCase.status] ?? progressGlyph(testCase.status),
    testCase.status,
    format.colors !== false,
  )).join('');
  const passed = countStatus(cases, 'passed');
  const failed = countStatus(cases, 'failed');
  const errored = countStatus(cases, 'errored');
  const skipped = countStatus(cases, 'skipped');
  return `${indicators}\n${cases.length} tests: ${passed} passed, ${failed} failed, ${errored} errors, ${skipped} skipped\n`;
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
    const failureLocation = isFailure(testCase.status) ? firstFailureLocation([testCase]) : {};
    const file = failureLocation.file ?? testCase.file;
    const line = failureLocation.line ?? testCase.line;
    const location = isFailure(testCase.status) ? formatFailureLocation(file, line, format) : undefined;
    const snippet = isFailure(testCase.status) && file && line
      ? sourceSnippets.get(sourceSnippetKey(file, line))
      : undefined;
    const detail = formatFailureMessage(testCase.message, format);
    const lines = [
      result,
      ...(location ? [location] : []),
      ...(snippet && format.sourceSnippet !== false ? [formatSnippet(snippet, format)] : []),
      ...(detail ? [detail] : []),
    ];
    return {
      text: `${lines.join('\n')}\n`,
      ...(location && file && line ? { location: { file, line } } : {}),
    };
  });
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
  return format.failureMessage
    ? renderTemplate(format.failureMessage, { message })
    : indent(message, '  ');
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(status|icon|name|duration|file|line|message)\}/g, (_, key: string) => values[key] ?? '');
}

function formatSnippet(snippet: string, format: TestOutputFormat): string {
  return format.colors === false ? snippet.replace(/\u001b\[[0-9;]*m/g, '') : snippet;
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

function countStatus(cases: JUnitTestCase[], status: JUnitStatus): number {
  return cases.filter((testCase) => testCase.status === status).length;
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
