import * as fs from 'fs/promises';
import * as path from 'path';
import type { Invocation, RunnerConfig, TestTarget } from './types';
import {
  escapeRegex,
  isPhpScript,
  mapCommandForContainer,
  mapHostPathToContainer,
  resolvePath,
} from './paths';

export async function autoDetectPhpUnit(workspacePath: string, platform = process.platform): Promise<string> {
  const candidates = platform === 'win32'
    ? ['vendor\\bin\\phpunit.bat', 'vendor\\bin\\phpunit']
    : ['vendor/bin/phpunit'];

  for (const candidate of candidates) {
    const resolved = path.join(workspacePath, candidate);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      continue;
    }
  }

  return 'phpunit';
}

export async function autoDetectConfigurationFile(workspacePath: string): Promise<string | undefined> {
  for (const candidate of ['phpunit.xml', 'phpunit.xml.dist']) {
    const resolved = path.join(workspacePath, candidate);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function resolveInvocation(options: {
  workspacePath: string;
  target: TestTarget;
  config: RunnerConfig;
  junitLogPath?: string;
  coverageCloverPath?: string;
  debug?: boolean;
  phpunitExecutable?: string;
  detectedConfigurationFile?: string;
}): Promise<Invocation> {
  const { workspacePath, target, config } = options;
  const configuredWorkingDirectory = config.workingDirectory.trim();
  const cwd = configuredWorkingDirectory
    ? resolvePath(workspacePath, configuredWorkingDirectory)
    : workspacePath;

  const phpunitExecutable = options.phpunitExecutable
    ?? (config.phpunitCommand.trim() || await autoDetectPhpUnit(workspacePath));
  const phpExecutable = config.phpExecutable.trim() || 'php';
  const args: string[] = [];

  const needsPhp = isPhpScript(phpunitExecutable);
  const command = needsPhp ? phpExecutable : phpunitExecutable;
  if (needsPhp) {
    if (options.debug && !config.dockerEnable) {
      args.push(
        `-dxdebug.mode=debug`,
        `-dxdebug.start_with_request=yes`,
        `-dxdebug.client_port=${config.xdebugPort || 9003}`,
      );
    }
    args.push(phpunitExecutable);
  }

  const configurationFile = config.configurationFile.trim()
    || options.detectedConfigurationFile
    || await autoDetectConfigurationFile(cwd);
  if (configurationFile) {
    args.push('--configuration', resolvePath(workspacePath, configurationFile));
  }

  args.push('--colors=always');
  args.push(...config.additionalArgs);

  if (options.junitLogPath) {
    args.push('--log-junit', options.junitLogPath);
  }

  if (options.coverageCloverPath) {
    args.push('--coverage-clover', options.coverageCloverPath);
  }

  if (target.group) {
    args.push('--group', target.group);
  }

  if (target.className && target.methodName) {
    args.push('--filter', `^${escapeRegex(target.className)}::${escapeRegex(target.methodName)}$`);
  } else if (target.className) {
    args.push('--filter', `^${escapeRegex(target.className)}(?:::.*)?$`);
  }

  if (target.filePath) {
    args.push(target.filePath);
  }

  const invocation = { command, args, cwd };
  if (!config.dockerEnable) {
    return invocation;
  }

  return resolveDockerInvocation(workspacePath, config, invocation, options.debug === true);
}

export function resolveDockerInvocation(
  workspacePath: string,
  config: RunnerConfig,
  invocation: Invocation,
  debug = false,
): Invocation {
  const dockerCommand = config.dockerCommand.trim() || 'docker';
  const container = config.dockerContainer.trim();
  if (!container) {
    throw new Error('phpunitRunner.docker.container must be set when docker execution is enabled.');
  }

  const containerWorkspacePath = config.dockerWorkspacePath.trim() || workspacePath;
  const containerCwd = mapHostPathToContainer(invocation.cwd, workspacePath, containerWorkspacePath);
  const containerCommand = mapCommandForContainer(invocation.command, workspacePath, containerWorkspacePath);
  const containerArgs = invocation.args.map((arg) =>
    mapHostPathToContainer(arg, workspacePath, containerWorkspacePath),
  );
  const debugEnv = debug
    ? ['-e', 'XDEBUG_TRIGGER=1', '-e', 'XDEBUG_SESSION=1']
    : [];

  return {
    command: dockerCommand,
    args: ['exec', '-i', ...debugEnv, ...config.dockerExecArgs, '-w', containerCwd, container, containerCommand, ...containerArgs],
    cwd: workspacePath,
  };
}
