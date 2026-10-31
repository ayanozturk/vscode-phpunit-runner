import * as path from 'path';

export function resolvePath(workspacePath: string, targetPath: string): string {
  const pathApi = pathApiFor(workspacePath, targetPath);
  return pathApi.isAbsolute(targetPath) ? targetPath : pathApi.join(workspacePath, targetPath);
}

export function toPosixPath(targetPath: string): string {
  return targetPath.replace(/\\/g, '/');
}

export function normalizePathForComparison(targetPath: string): string {
  const pathApi = pathApiFor(targetPath);
  const normalized = toPosixPath(pathApi.resolve(targetPath));
  return pathApi === path.win32 ? normalized.toLowerCase() : normalized;
}

export function mapHostPathToContainer(
  targetPath: string,
  hostWorkspacePath: string,
  containerWorkspacePath: string,
): string {
  const pathApi = pathApiFor(hostWorkspacePath, targetPath);
  const normalizedHostWorkspace = normalizePathForComparison(hostWorkspacePath);
  const normalizedTarget = normalizePathForComparison(targetPath);
  const relativePath = pathApi.relative(hostWorkspacePath, targetPath);
  const isInsideWorkspace = relativePath === ''
    || (!pathApi.isAbsolute(relativePath)
      && relativePath !== '..'
      && !relativePath.startsWith(`..${pathApi.sep}`));

  if (normalizedTarget === normalizedHostWorkspace || isInsideWorkspace) {
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
  if (pathApiFor(command).isAbsolute(command)) {
    return mapHostPathToContainer(command, hostWorkspacePath, containerWorkspacePath);
  }

  return command;
}

type PathApi = typeof path.posix | typeof path.win32;

function pathApiFor(...paths: string[]): PathApi {
  return paths.some(isWindowsAbsolutePath) ? path.win32 : path;
}

function isWindowsAbsolutePath(targetPath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(targetPath)
    || /^\\\\[^\\]+\\[^\\]+/.test(targetPath)
    || /^\/\/[^/]+\/[^/]+/.test(targetPath);
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
