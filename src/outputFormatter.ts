import type { JUnitTestCase, JUnitStatus } from './types';

export type OutputPreset = 'collision' | 'progress' | 'pretty';

export function formatTestOutput(
  cases: JUnitTestCase[],
  preset: OutputPreset,
  fallbackOutput = '',
): string {
  if (cases.length === 0) {
    return ensureTrailingNewline(fallbackOutput);
  }

  switch (preset) {
    case 'progress':
      return formatProgress(cases);
    case 'pretty':
      return formatPretty(cases);
    case 'collision':
    default:
      return formatCollision(cases);
  }
}

function formatCollision(cases: JUnitTestCase[]): string {
  const lines = cases.flatMap((testCase) => {
    const location = testCase.file && testCase.line
      ? `  ${testCase.file}:${testCase.line}`
      : undefined;
    const message = isFailure(testCase.status) && testCase.message
      ? indent(testCase.message, '  ')
      : undefined;
    return [
      `${statusGlyph(testCase.status)} ${testCase.name}${formatDuration(testCase.timeSeconds)}`,
      ...(location ? [location] : []),
      ...(message ? [message] : []),
    ];
  });
  return `${lines.join('\n')}\n`;
}

function formatProgress(cases: JUnitTestCase[]): string {
  const indicators = cases.map((testCase) => progressGlyph(testCase.status)).join('');
  const passed = countStatus(cases, 'passed');
  const failed = countStatus(cases, 'failed');
  const errored = countStatus(cases, 'errored');
  const skipped = countStatus(cases, 'skipped');
  return `${indicators}\n${cases.length} tests: ${passed} passed, ${failed} failed, ${errored} errors, ${skipped} skipped\n`;
}

function formatPretty(cases: JUnitTestCase[]): string {
  const lines = cases.flatMap((testCase) => {
    const result = `${statusLabel(testCase.status)} ${testCase.name}${formatDuration(testCase.timeSeconds)}`;
    const detail = isFailure(testCase.status) && testCase.message
      ? indent(testCase.message, '  ')
      : undefined;
    return [result, ...(detail ? [detail] : [])];
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
