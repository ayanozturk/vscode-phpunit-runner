import * as path from 'path';
import { unmapWithMappings, type PathMapping } from './commandTemplate';

export function resolveOutputFilePath(
  file: string | undefined,
  line: number | undefined,
  workspacePath: string | undefined,
  mappings: PathMapping[] = [],
): string | undefined {
  if (!file || !Number.isInteger(line) || line === undefined || line < 1) {
    return undefined;
  }

  const localFile = unmapWithMappings(file, mappings);
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(localFile)
    || /^\\\\[^\\]+\\[^\\]+/.test(localFile);
  if (isWindowsAbsolute && process.platform !== 'win32') {
    return undefined;
  }

  return path.isAbsolute(localFile)
    ? localFile
    : workspacePath ? path.resolve(workspacePath, localFile) : undefined;
}
