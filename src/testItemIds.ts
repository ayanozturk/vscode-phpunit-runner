/** Stable ids used to group discovered files under workspace, suite, and folder items. */
export function makeWorkspaceItemId(workspaceUri: string): string {
  return `workspace:${workspaceUri}`;
}

export function makeSuiteItemId(workspaceUri: string, suiteName: string): string {
  return `suite:${workspaceUri}:${suiteName}`;
}

export function makeFolderItemId(workspaceUri: string, segments: readonly string[], suiteName?: string): string {
  const prefix = suiteName
    ? `${makeSuiteItemId(workspaceUri, suiteName)}:`
    : `folder:${workspaceUri}:`;
  return `${prefix}${segments.join('/')}`;
}
