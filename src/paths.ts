import * as path from 'path';

export function resolvePath(workspacePath: string, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.join(workspacePath, targetPath);
}

export function toPosixPath(targetPath: string): string {
  return targetPath.replace(/\\/g, '/');
}

export function normalizePathForComparison(targetPath: string): string {
  return toPosixPath(path.resolve(targetPath));
}

export function mapHostPathToContainer(
  targetPath: string,
  hostWorkspacePath: string,
  containerWorkspacePath: string,
): string {
  const normalizedHostWorkspace = normalizePathForComparison(hostWorkspacePath);
  const normalizedTarget = normalizePathForComparison(targetPath);

  if (normalizedTarget === normalizedHostWorkspace || normalizedTarget.startsWith(`${normalizedHostWorkspace}/`)) {
    const relativePath = path.relative(hostWorkspacePath, targetPath);
    return relativePath
      ? path.posix.join(toPosixPath(containerWorkspacePath), toPosixPath(relativePath))
      : toPosixPath(containerWorkspacePath);
  }

  return targetPath;
}

export function mapCommandForContainer(
  command: string,
  hostWorkspacePath: string,
  containerWorkspacePath: string,
): string {
  if (path.isAbsolute(command)) {
    return mapHostPathToContainer(command, hostWorkspacePath, containerWorkspacePath);
  }

  return command;
}

export function isPhpScript(command: string): boolean {
  const normalized = command.toLowerCase();
  return normalized.endsWith('/phpunit')
    || normalized.endsWith('\\phpunit')
    || normalized.endsWith('.php');
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const DEFAULT_TEST_GLOBS = ['**/*Test.php', '**/tests/**/*.php'];
export const DEFAULT_EXCLUDE_GLOBS = ['**/vendor/**', '**/node_modules/**', '**/.git/**'];
