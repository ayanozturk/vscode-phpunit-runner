import * as fs from 'fs/promises';
import * as path from 'path';
import { parseComposerFrameworkInfo, type ComposerFrameworkInfo } from './composerMetadata';

export type { ComposerFrameworkInfo } from './composerMetadata';

/** Reads optional Composer declarations and locked PHPUnit/Pest versions. */
export async function readFrameworkInfo(root: string): Promise<ComposerFrameworkInfo> {
  const [manifestText, lockText] = await Promise.all([
    readOptionalFile(path.join(root, 'composer.json')),
    readOptionalFile(path.join(root, 'composer.lock')),
  ]);
  return parseComposerFrameworkInfo(manifestText, lockText);
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}
