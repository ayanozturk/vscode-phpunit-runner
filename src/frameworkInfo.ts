import * as fs from 'fs/promises';
import * as path from 'path';

export type ComposerFrameworkInfo = {
  pestDeclared: boolean;
  versions: Map<string, string>;
};

/** Reads optional Composer declarations and locked PHPUnit/Pest versions. */
export async function readFrameworkInfo(root: string): Promise<ComposerFrameworkInfo> {
  let pestDeclared = false;
  const versions = new Map<string, string>();
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'composer.json'), 'utf8')) as {
      require?: Record<string, unknown>;
      'require-dev'?: Record<string, unknown>;
    };
    pestDeclared = Boolean(manifest.require?.['pestphp/pest'] || manifest['require-dev']?.['pestphp/pest']);
  } catch {
    // Composer metadata is optional; binary detection below remains useful.
  }

  try {
    const lock = JSON.parse(await fs.readFile(path.join(root, 'composer.lock'), 'utf8')) as {
      packages?: Array<{ name?: string; version?: string }>;
      'packages-dev'?: Array<{ name?: string; version?: string }>;
    };
    for (const pkg of [...(lock.packages ?? []), ...(lock['packages-dev'] ?? [])]) {
      if ((pkg.name === 'pestphp/pest' || pkg.name === 'phpunit/phpunit') && pkg.version) {
        versions.set(pkg.name, pkg.version);
      }
    }
  } catch {
    // A missing or invalid lock file only omits the displayed version.
  }

  return { pestDeclared, versions };
}
