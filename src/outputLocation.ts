import * as path from 'path';
import { unmapWithMappings, type PathMapping } from './commandTemplate';
import { isWindowsAbsolutePath } from './paths';

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
  if (isWindowsAbsolutePath(localFile) && process.platform !== 'win32') {
    return undefined;
  }

  return path.isAbsolute(localFile)
    ? localFile
    : workspacePath ? path.resolve(workspacePath, localFile) : undefined;
}
