/** Keeps a bounded, readable first-line summary without persisting stack traces. */
export function normalizeFailureMessage(message: string): string {
  const firstLine = message.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const normalized = firstLine
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 200 ? `${normalized.slice(0, 199).trimEnd()}…` : normalized;
}
