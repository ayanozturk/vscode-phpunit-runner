export type ComposerFrameworkInfo = {
  pestDeclared: boolean;
  versions: Map<string, string>;
};

/** Decodes the Composer manifest and lock excerpts used for framework selection and display. */
export function parseComposerFrameworkInfo(
  manifestText?: string,
  lockText?: string,
): ComposerFrameworkInfo {
  let pestDeclared = false;
  if (manifestText) {
    try {
      const manifest = JSON.parse(manifestText) as {
        require?: Record<string, unknown>;
        'require-dev'?: Record<string, unknown>;
      };
      pestDeclared = Boolean(manifest.require?.['pestphp/pest'] || manifest['require-dev']?.['pestphp/pest']);
    } catch {
      // Invalid manifest JSON does not prevent reading locked package versions.
    }
  }

  const versions = new Map<string, string>();
  if (lockText) {
    try {
      const lock = JSON.parse(lockText) as {
        packages?: Array<{ name?: string; version?: string }>;
        'packages-dev'?: Array<{ name?: string; version?: string }>;
      };
      for (const pkg of [...(lock.packages ?? []), ...(lock['packages-dev'] ?? [])]) {
        if ((pkg.name === 'pestphp/pest' || pkg.name === 'phpunit/phpunit') && pkg.version) {
          versions.set(pkg.name, pkg.version);
        }
      }
    } catch {
      // Invalid lock JSON only omits displayed versions.
    }
  }

  return { pestDeclared, versions };
}
