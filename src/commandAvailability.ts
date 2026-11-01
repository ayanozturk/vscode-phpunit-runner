import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import * as path from 'path';

export type CommandSearchOptions = {
  platform?: NodeJS.Platform;
  pathValue?: string;
  pathExt?: string;
};

const PATH_PROBE_CONCURRENCY = 8;

export function firstCommandToken(command: string): string {
  const match = command.trim().match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

/** Checks all PATH candidates concurrently so late PATH entries do not add serial filesystem latency. */
export async function commandAvailable(
  command: string,
  cwd: string,
  options: CommandSearchOptions = {},
): Promise<boolean> {
  if (!command) {
    return false;
  }

  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const hasPathSeparator = command.includes('/') || command.includes('\\');
  if (pathApi.isAbsolute(command) || hasPathSeparator) {
    const candidate = pathApi.isAbsolute(command) ? command : pathApi.resolve(cwd, command);
    return pathIsExecutable(candidate);
  }

  const pathDelimiter = platform === 'win32' ? ';' : path.delimiter;
  const pathEntries = (options.pathValue ?? process.env.PATH ?? '').split(pathDelimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? ['', ...(options.pathExt ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)]
    : [''];
  const candidates = pathEntries.flatMap((entry) => (
    extensions.map((extension) => pathApi.join(entry, `${command}${extension}`))
  ));
  for (let offset = 0; offset < candidates.length; offset += PATH_PROBE_CONCURRENCY) {
    const batch = candidates.slice(offset, offset + PATH_PROBE_CONCURRENCY);
    const available = await Promise.all(batch.map(pathIsExecutable));
    if (available.some(Boolean)) {
      return true;
    }
  }
  return false;
}

async function pathIsExecutable(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
