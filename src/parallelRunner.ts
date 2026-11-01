import * as fs from 'fs/promises';
import * as path from 'path';

export type ParallelRunner = 'pest' | 'paratest';

/** Detects a supported parallel driver without treating Artisan/custom runners as parallel-capable. */
export async function detectParallelRunner(options: {
  workspacePath: string;
  configuredRunner: string;
  commandTemplate?: string;
}): Promise<ParallelRunner | undefined> {
  const configuredRunner = options.configuredRunner.trim();
  const template = options.commandTemplate?.trim();
  if (template && (!template.includes('${phpunit}') || !template.includes('${phpunitargs}'))) {
    return undefined;
  }

  const configured = runnerInCommand(configuredRunner);
  if (configuredRunner && !configured) {
    return undefined;
  }
  if (configured === 'pest' || configured === 'paratest') {
    return configured;
  }
  if (configuredRunner && configured === 'php'
    && !/(?:^|[\\/\s])(?:phpunit|pest|paratest)(?:\.(?:bat|cmd|exe))?(?:$|[\\/\s])/i.test(configuredRunner)) {
    return undefined;
  }
  if (configured && configured !== 'phpunit' && configured !== 'php') {
    return undefined;
  }

  const composerDeclaresPest = await declaresPest(options.workspacePath);
  if (!configuredRunner && composerDeclaresPest && await exists(path.join(options.workspacePath, 'vendor', 'bin', 'pest'))) {
    return 'pest';
  }

  // On Windows Composer installs the Pest shim as `.bat`; keep the same
  // Pest-first selection as the extensionless executable path above.
  if (!configuredRunner && composerDeclaresPest && await exists(path.join(options.workspacePath, 'vendor', 'bin', 'pest.bat'))) {
    return 'pest';
  }

  if (await exists(path.join(options.workspacePath, 'vendor', 'bin', 'paratest'))
    || await exists(path.join(options.workspacePath, 'vendor', 'bin', 'paratest.bat'))) {
    return 'paratest';
  }
  return undefined;
}

export function parallelRunnerArguments(runner: ParallelRunner, processes: number): string[] {
  if (!Number.isInteger(processes) || processes < 1 || processes > 64) {
    throw new Error('Parallel process count must be an integer between 1 and 64.');
  }
  return runner === 'pest'
    ? ['--parallel', `--processes=${processes}`]
    : [`--processes=${processes}`];
}

function runnerInCommand(command: string): string | undefined {
  const tokens = command.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? [];
  let hasPhp = false;
  for (const token of tokens) {
    const unquoted = token.replace(/^(?:"|')|(?:"|')$/g, '');
    const base = path.win32.basename(unquoted).toLowerCase().replace(/\.(?:bat|cmd|exe)$/i, '');
    if (base === 'pest' || base === 'paratest' || base === 'phpunit') {
      return base;
    }
    hasPhp ||= base === 'php';
  }
  return hasPhp ? 'php' : undefined;
}

async function declaresPest(workspacePath: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(workspacePath, 'composer.json'), 'utf8')) as {
      require?: Record<string, unknown>;
      'require-dev'?: Record<string, unknown>;
    };
    return Boolean(manifest.require?.['pestphp/pest'] || manifest['require-dev']?.['pestphp/pest']);
  } catch {
    return false;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
