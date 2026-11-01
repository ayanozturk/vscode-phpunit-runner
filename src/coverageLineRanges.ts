export type CoverageLineRange = { start: number; end: number };

/** Expand inclusive, one-based coverage line ranges into individual line numbers. */
export function expandCoverageLineNumbers(ranges: readonly CoverageLineRange[]): number[] {
  const lines: number[] = [];
  for (const range of ranges) {
    for (let line = range.start; line <= range.end; line += 1) {
      lines.push(line);
    }
  }
  return lines;
}
