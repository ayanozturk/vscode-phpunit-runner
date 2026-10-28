import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  expandPathMappings,
  joinTemplateShellArgs,
  mapWithMappings,
  quoteTemplateShellArg,
  substituteVariables,
  type PathMapping,
} from './commandTemplate';
import type { Invocation, RunnerConfig, TestTarget } from './types';
import {
  escapeRegex,
  isPhpScript,
  mapCommandForContainer,
  mapHostPathToContainer,
  resolvePath,
} from './paths';

export async function autoDetectPhpUnit(workspacePath: string, platform = process.platform): Promise<string> {
  if (await declaresPest(workspacePath)) {
    const pestCandidates = platform === 'win32'
      ? ['vendor\\bin\\pest.bat', 'vendor\\bin\\pest']
      : ['vendor/bin/pest'];
    for (const candidate of pestCandidates) {
      const resolved = path.join(workspacePath, candidate);
      try {
        await fs.access(resolved);
        return resolved;
      } catch {
        // Fall back to PHPUnit when Pest is declared but its binary is not installed.
      }
    }
  }

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

async function declaresPest(workspacePath: string): Promise<boolean> {
  try {
    const composer = JSON.parse(await fs.readFile(path.join(workspacePath, 'composer.json'), 'utf8')) as {
      require?: Record<string, unknown>;
      'require-dev'?: Record<string, unknown>;
    };
    return Boolean(composer.require?.['pestphp/pest'] || composer['require-dev']?.['pestphp/pest']);
  } catch {
    return false;
  }
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
  userHome?: string;
}): Promise<Invocation> {
  const { workspacePath, target, config } = options;
  const configuredWorkingDirectory = config.workingDirectory.trim();
  const cwd = configuredWorkingDirectory
    ? resolvePath(workspacePath, configuredWorkingDirectory)
    : workspacePath;

  const phpunitExecutable = options.phpunitExecutable
    ?? (config.phpunitCommand.trim() || await autoDetectPhpUnit(workspacePath));
  const phpExecutable = config.phpExecutable.trim() || 'php';
  const phpArgs = [...config.phpArgs];
  if (options.debug) {
    phpArgs.push(
      `-dxdebug.mode=debug`,
      `-dxdebug.start_with_request=yes`,
      `-dxdebug.client_port=${config.xdebugPort > 0 ? config.xdebugPort : 9003}`,
    );
  }

  const phpunitArgs: string[] = [];
  const configurationFile = config.configurationFile.trim()
    || options.detectedConfigurationFile
    || await autoDetectConfigurationFile(cwd);
  if (configurationFile) {
    phpunitArgs.push('--configuration', resolvePath(workspacePath, configurationFile));
  }

  phpunitArgs.push('--colors=always');
  phpunitArgs.push(...config.additionalArgs);

  if (options.junitLogPath) {
    phpunitArgs.push('--log-junit', options.junitLogPath);
  }

  if (options.coverageCloverPath) {
    phpunitArgs.push('--coverage-clover', options.coverageCloverPath);
  }

  if (target.group) {
    phpunitArgs.push('--group', target.group);
  }
  if (target.suiteName) {
    phpunitArgs.push('--testsuite', target.suiteName);
  }

  if (target.className && target.methodName) {
    phpunitArgs.push('--filter', `^${escapeRegex(target.className)}::${escapeRegex(target.methodName)}$`);
  } else if (target.className) {
    phpunitArgs.push('--filter', `^${escapeRegex(target.className)}(?:::.*)?$`);
  }

  if (target.filePath) {
    phpunitArgs.push(target.filePath);
  }

  const vars = templateVars(workspacePath, cwd, options.userHome ?? os.homedir());
  const mappings = resolveMappings(workspacePath, config, vars);
  const env = {
    ...config.environment,
    ...(options.debug ? { XDEBUG_TRIGGER: '1', XDEBUG_SESSION: '1' } : {}),
  };

  const template = config.command.trim();
  if (template) {
    return renderRemoteInvocation({
      template,
      phpExecutable,
      phpArgs,
      phpunitExecutable,
      phpunitArgs,
      cwd,
      vars,
      mappings,
      env,
    });
  }

  const needsPhp = isPhpScript(phpunitExecutable);
  const command = needsPhp ? phpExecutable : phpunitExecutable;
  const args = needsPhp ? [...phpArgs, phpunitExecutable, ...phpunitArgs] : [...phpunitArgs];
  const local: Invocation = { command, args, cwd, env, mappings };

  if (!config.dockerEnable) {
    return local;
  }

  return {
    ...resolveDockerInvocation(workspacePath, config, local, options.debug === true),
    env,
    mappings: mappings.length > 0 ? mappings : dockerMappings(workspacePath, config),
  };
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

function renderRemoteInvocation(options: {
  template: string;
  phpExecutable: string;
  phpArgs: string[];
  phpunitExecutable: string;
  phpunitArgs: string[];
  cwd: string;
  vars: Record<string, string>;
  mappings: PathMapping[];
  env: Record<string, string>;
}): Invocation {
  const php = mapWithMappings(options.phpExecutable, options.mappings);
  const phpunit = mapWithMappings(options.phpunitExecutable, options.mappings);
  const cwd = mapWithMappings(options.cwd, options.mappings);
  const mappedPhpunitArgs = options.phpunitArgs.map((arg) => mapWithMappings(arg, options.mappings));
  const phpunitxmlIndex = mappedPhpunitArgs.indexOf('--configuration');
  const phpunitxml = phpunitxmlIndex >= 0 ? mappedPhpunitArgs[phpunitxmlIndex + 1] ?? '' : '';
  const quotedVars = Object.fromEntries(
    Object.entries(options.vars).map(([name, value]) => [name, quoteTemplateShellArg(value)]),
  );

  const rendered = substituteVariables(options.template, {
    ...quotedVars,
    php: quoteTemplateShellArg(php),
    phpargs: joinTemplateShellArgs(options.phpArgs),
    phpunit: quoteTemplateShellArg(phpunit),
    phpunitargs: joinTemplateShellArgs(mappedPhpunitArgs),
    phpunitxml: quoteTemplateShellArg(phpunitxml),
    cwd: quoteTemplateShellArg(cwd),
  });

  return {
    command: rendered,
    args: [],
    cwd: options.vars.workspaceFolder,
    env: options.env,
    shell: true,
    mappings: options.mappings,
  };
}

function templateVars(workspacePath: string, cwd: string, userHome: string): Record<string, string> {
  return {
    workspaceFolder: workspacePath,
    workspaceFolderBasename: path.basename(workspacePath),
    userHome,
    pathSeparator: path.sep,
    cwd,
  };
}

function resolveMappings(
  workspacePath: string,
  config: RunnerConfig,
  vars: Record<string, string>,
): PathMapping[] {
  const record = { ...config.paths };
  const dockerRoot = config.dockerWorkspacePath.trim();
  if (dockerRoot && !Object.prototype.hasOwnProperty.call(record, '${workspaceFolder}')) {
    const hasExplicitMaps = Object.keys(record).length > 0;
    if (config.dockerEnable || (config.command.trim() && !hasExplicitMaps)) {
      record['${workspaceFolder}'] = dockerRoot;
    }
  }
  const expanded = expandPathMappings(record, vars);
  if (expanded.length === 0 && config.dockerEnable && dockerRoot) {
    return dockerMappings(workspacePath, config);
  }
  return expanded;
}

function dockerMappings(workspacePath: string, config: RunnerConfig): PathMapping[] {
  const remote = config.dockerWorkspacePath.trim();
  if (!remote) {
    return [];
  }
  return [{ from: workspacePath.replace(/\\/g, '/'), to: remote.replace(/\\/g, '/') }];
}
