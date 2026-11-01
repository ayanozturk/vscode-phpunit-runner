import * as path from 'path';
import type { PhpUnitSuite } from './phpunitXml';

/** Resolve the configured PHPUnit suite that owns a discovered test file. */
export function findSuiteForFile(
  filePath: string,
  xmlDirectory: string,
  suites: PhpUnitSuite[],
): string | undefined {
  const resolvedFilePath = path.resolve(filePath);
  for (const suite of suites) {
    const excluded = suite.excludes.some((exclude) => isPathInside(
      resolvedFilePath,
      path.resolve(xmlDirectory, exclude),
    ));
    if (excluded) {
      continue;
    }

    const includesFile = suite.files.some((file) => path.resolve(xmlDirectory, file) === resolvedFilePath);
    const includesDirectory = suite.directories.some((directory) => {
      const basePath = path.resolve(xmlDirectory, directory.path);
      const basename = path.basename(resolvedFilePath);
      const prefix = directory.prefix ?? '';
      const suffix = directory.suffix?.replace(/^\*/, '') || '.php';
      return isPathInside(resolvedFilePath, basePath)
        && basename.startsWith(prefix)
        && basename.endsWith(suffix);
    });
    if (includesFile || includesDirectory) {
      return suite.name;
    }
  }

  return undefined;
}

function isPathInside(filePath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, filePath);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
