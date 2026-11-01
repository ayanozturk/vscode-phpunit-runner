import type { PathMapping } from './commandTemplate';

/** Adds the Docker workspace fallback when configured mappings do not cover it. */
export function resolveDockerPathMappings(
  workspacePath: string,
  dockerWorkspacePath: string,
  configuredMappings: readonly PathMapping[],
): PathMapping[] {
  const normalizedWorkspacePath = normalizeDockerPath(workspacePath);
  const workspaceIsCovered = configuredMappings.some(({ from }) => {
    const normalizedFrom = normalizeDockerPath(from);
    return normalizedWorkspacePath === normalizedFrom
      || normalizedWorkspacePath.startsWith(`${normalizedFrom}/`);
  });
  const mappings = workspaceIsCovered || !dockerWorkspacePath.trim()
    ? [...configuredMappings]
    : [
      ...configuredMappings,
      { from: workspacePath.replace(/\\/g, '/'), to: dockerWorkspacePath.trim().replace(/\\/g, '/') },
    ];
  return mappings.sort((left, right) => right.from.length - left.from.length);
}

function normalizeDockerPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}
