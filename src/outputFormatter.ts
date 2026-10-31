import type { JUnitTestCase, JUnitStatus } from './types';
import { firstFailureLocation } from './junit';

export type OutputPreset = 'collision' | 'progress' | 'pretty';

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
): string {
  if (cases.length === 0) {
    return ensureTrailingNewline(fallbackOutput);
  }

  switch (preset) {
    case 'progress':
      return formatProgress(cases);
    case 'pretty':
      return formatPretty(cases, sourceSnippets);
    case 'collision':
    default:
      return formatCollision(cases, sourceSnippets);
  }
}

function formatCollision(cases: JUnitTestCase[], sourceSnippets: ReadonlyMap<string, string>): string {
  const lines = cases.flatMap((testCase) => {
    const failureLocation = isFailure(testCase.status) ? firstFailureLocation([testCase]) : {};
    const file = failureLocation.file ?? testCase.file;
    const line = failureLocation.line ?? testCase.line;
    const location = file && line
      ? `  ${file}:${line}`
      : undefined;
    const message = isFailure(testCase.status) && testCase.message
      ? indent(testCase.message, '  ')
      : undefined;
    const snippet = isFailure(testCase.status) && file && line
      ? sourceSnippets.get(sourceSnippetKey(file, line))
      : undefined;
    return [
      `${colorStatusGlyph(statusGlyph(testCase.status), testCase.status)} ${testCase.name}${formatDuration(testCase.timeSeconds)}`,
      ...(location ? [location] : []),
      ...(snippet ? [snippet] : []),
      ...(message ? [message] : []),
    ];
  });
  return `${lines.join('\n')}\n`;
}

function formatProgress(cases: JUnitTestCase[]): string {
  const indicators = cases.map((testCase) => colorStatusGlyph(progressGlyph(testCase.status), testCase.status)).join('');
  const passed = countStatus(cases, 'passed');
  const failed = countStatus(cases, 'failed');
  const errored = countStatus(cases, 'errored');
  const skipped = countStatus(cases, 'skipped');
  return `${indicators}\n${cases.length} tests: ${passed} passed, ${failed} failed, ${errored} errors, ${skipped} skipped\n`;
}

function formatPretty(cases: JUnitTestCase[], sourceSnippets: ReadonlyMap<string, string>): string {
  const lines = cases.flatMap((testCase) => {
    const result = `${colorStatusLabel(statusLabel(testCase.status), testCase.status)} ${testCase.name}${formatDuration(testCase.timeSeconds)}`;
    const failureLocation = isFailure(testCase.status) ? firstFailureLocation([testCase]) : {};
    const file = failureLocation.file ?? testCase.file;
    const line = failureLocation.line ?? testCase.line;
    const location = isFailure(testCase.status) && file && line ? `  ${file}:${line}` : undefined;
    const snippet = isFailure(testCase.status) && file && line
      ? sourceSnippets.get(sourceSnippetKey(file, line))
      : undefined;
    const detail = isFailure(testCase.status) && testCase.message
      ? indent(testCase.message, '  ')
      : undefined;
    return [result, ...(location ? [location] : []), ...(snippet ? [snippet] : []), ...(detail ? [detail] : [])];
  });
  return `${lines.join('\n')}\n`;
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

function colorStatusGlyph(value: string, status: JUnitStatus): string {
  return `${statusColor(status)}${value}${ANSI.reset}`;
}

function colorStatusLabel(value: string, status: JUnitStatus): string {
  return `${statusColor(status)}${value}${ANSI.reset}`;
}

function statusColor(status: JUnitStatus): string {
  switch (status) {
    case 'passed': return ANSI.green;
    case 'failed':
    case 'errored': return ANSI.red;
    case 'skipped': return ANSI.yellow;
  }
}
