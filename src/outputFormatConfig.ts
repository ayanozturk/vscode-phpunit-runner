import type { JUnitStatus } from './types';
import type { TestOutputFormat } from './outputFormatter';

/** Parses workspace settings into the supported output-format overrides. */
export function parseTestOutputFormat(value: unknown): TestOutputFormat {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const format = value as Record<string, unknown>;
  return {
    colors: typeof format.colors === 'boolean' ? format.colors : undefined,
    duration: typeof format.duration === 'boolean' ? format.duration : undefined,
    icons: parseIcons(format.icons),
    testCase: typeof format.testCase === 'string' ? format.testCase : undefined,
    failureLocation: typeof format.failureLocation === 'string' ? format.failureLocation : undefined,
    failureMessage: typeof format.failureMessage === 'string' ? format.failureMessage : undefined,
    sourceSnippet: typeof format.sourceSnippet === 'boolean' ? format.sourceSnippet : undefined,
  };
}

function parseIcons(value: unknown): TestOutputFormat['icons'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const icons = value as Record<string, unknown>;
  const result: Partial<Record<JUnitStatus, string>> = {};
  for (const status of ['passed', 'failed', 'errored', 'skipped'] as const) {
    if (typeof icons[status] === 'string') {
      result[status] = icons[status] as string;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
