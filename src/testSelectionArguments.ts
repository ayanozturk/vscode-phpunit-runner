import { escapeRegex } from './paths';
import type { TestTarget } from './types';

/** Removes parallel overrides so the selected runner can apply its own scope. */
export function withoutParallelOverrides(args: readonly string[]): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (/^--parallel(?:=.*)?$/i.test(argument)) {
      continue;
    }
    if (/^--processes(?:=.*)?$/i.test(argument)) {
      if (argument === '--processes' && args[index + 1] && !args[index + 1].startsWith('--')) {
        index += 1;
      }
      continue;
    }
    filtered.push(argument);
  }
  return filtered;
}

/** Builds the escaped PHPUnit/Pest filter for one discovered target. */
export function buildTargetFilter(target: TestTarget): string | undefined {
  if (target.datasetName && target.className) {
    return `~^${escapeRegex(`${target.className}::${target.datasetName}`)}$~i`;
  }
  if (target.pestTestName) {
    return `~${escapeRegex(target.pestTestName)}~i`;
  }
  if (target.className && target.methodName) {
    return `~^${escapeRegex(target.className)}::${escapeRegex(target.methodName)}(?: with data set .*)?$~i`;
  }
  if (target.className) {
    return `~^${escapeRegex(target.className)}(?:::.*)?$~i`;
  }
  return undefined;
}
