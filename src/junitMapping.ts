import { unmapWithMappings, type PathMapping } from './commandTemplate';
import type { JUnitTestCase } from './types';

/** Maps JUnit source locations and path references in failure text to host paths. */
export function remapJUnitCases(cases: JUnitTestCase[], mappings: PathMapping[]): JUnitTestCase[] {
  if (mappings.length === 0) {
    return cases;
  }
  const normalizedMappings = mappings.map(({ from, to }) => ({
    from: from.replace(/\\/g, '/'),
    to: to.replace(/\\/g, '/'),
  }));

  return cases.map((testCase) => ({
    ...testCase,
    file: testCase.file ? unmapWithMappings(testCase.file, normalizedMappings) : testCase.file,
    message: remapPathsInText(testCase.message, normalizedMappings),
  }));
}

function remapPathsInText(message: string, mappings: PathMapping[]): string {
  const targets = [...mappings]
    .filter(({ to }) => to.length > 0)
    .sort((left, right) => right.to.length - left.to.length)
    .map(({ to }) => pathPattern(to));
  if (targets.length === 0) {
    return message;
  }

  const pathMatcher = new RegExp(targets.join('|'), 'g');
  return message.replace(pathMatcher, (match, offset: number, source: string) => {
    const previous = source[offset - 1];
    const next = source[offset + match.length];
    if ((previous !== undefined && !/[\s"'`([{=:]/.test(previous))
      || (next !== undefined && !/[\\/:\s"'`),;!?}\]]/.test(next))) {
      return match;
    }
    return unmapWithMappings(match, mappings);
  });
}

function pathPattern(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[/\\\\]');
}
