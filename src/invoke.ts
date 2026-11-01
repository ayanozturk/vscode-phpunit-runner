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
import { parallelRunnerArguments, type ParallelRunner } from './parallelRunner';
import {
  escapeRegex,
  isPhpScript,
  resolvePath,
} from './paths';

export async function autoDetectPhpUnit(workspacePath: string, platform = process.platform): Promise<string> {
  if (await declaresPest(workspacePath)) {
    const pestCandidates = platform === 'win32'
      ? ['vendor\\bin\\pest', 'vendor\\bin\\pest.bat']
      : ['vendor/bin/pest'];
    const pestPath = await firstExistingPath(workspacePath, pestCandidates);
    if (pestPath) {
      return pestPath;
    }
  }

  const candidates = platform === 'win32'
    ? ['vendor\\bin\\phpunit', 'vendor\\bin\\phpunit.bat', 'phpunit.phar']
    : ['vendor/bin/phpunit', 'phpunit.phar'];

  return await firstExistingPath(workspacePath, candidates) ?? 'phpunit';
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
  return firstExistingPath(workspacePath, ['phpunit.xml', 'phpunit.xml.dist']);
}

async function firstExistingPath(workspacePath: string, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    const resolved = path.join(workspacePath, candidate);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      // Continue to the next configured fallback.
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
  testListingXmlPath?: string;
  parallelRunner?: ParallelRunner;
  parallelProcesses?: number;
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
  const additionalArgs = options.parallelRunner
    ? withoutParallelOverrides(config.additionalArgs)
    : config.additionalArgs;
  phpunitArgs.push(...additionalArgs);
  if (options.parallelRunner) {
    phpunitArgs.push(...parallelRunnerArguments(options.parallelRunner, options.parallelProcesses ?? 2));
  }

  if (options.junitLogPath) {
    phpunitArgs.push('--log-junit', options.junitLogPath);
  }

  if (options.coverageCloverPath) {
    phpunitArgs.push('--coverage-clover', options.coverageCloverPath);
  }
  if (options.testListingXmlPath) {
    phpunitArgs.push('--list-tests-xml', options.testListingXmlPath);
  }

  if (target.group) {
    phpunitArgs.push('--group', target.group);
  }
  if (target.suiteName) {
    phpunitArgs.push('--testsuite', target.suiteName);
  }

  const filter = buildTargetFilter(target);
  if (filter) {
    phpunitArgs.push('--filter', filter);
  }

  phpunitArgs.push(...(target.filePaths ?? (target.filePath ? [target.filePath] : [])));

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

  const runnerCommand = await parseRunnerCommand(phpunitExecutable, cwd);
  const commandIsPhp = isPhpBinary(runnerCommand.command);
  const needsPhp = !commandIsPhp && isPhpRunnerScript(runnerCommand.command);
  const command = needsPhp ? phpExecutable : runnerCommand.command;
  const args = commandIsPhp
    ? [...phpArgs, ...runnerCommand.args, ...phpunitArgs]
    : needsPhp
      ? [...phpArgs, runnerCommand.command, ...runnerCommand.args, ...phpunitArgs]
      : [...runnerCommand.args, ...phpunitArgs];
  const local: Invocation = { command, args, cwd, env, mappings };

  if (!config.dockerEnable) {
    return local;
  }

  return {
    ...resolveDockerInvocation(workspacePath, config, local, options.debug === true),
    env,
    mappings: resolveDockerPathMappings(workspacePath, config, mappings),
  };
}

function withoutParallelOverrides(args: string[]): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (/^--parallel(?:=.*)?$/i.test(argument)) {
      continue;
    }
    if (/^--processes(?:=.*)?$/i.test(argument)) {
      if (argument === '--processes' && args[index + 1] && !args[index + 1].startsWith('--')) {
        index += 1;
      }
      continue;
    }
    filtered.push(argument);
  }
  return filtered;
}

type ParsedRunnerCommand = { command: string; args: string[] };

function buildTargetFilter(target: TestTarget): string | undefined {
  if (target.datasetName && target.className) {
    return `~^${escapeRegex(`${target.className}::${target.datasetName}`)}$~i`;
  }
  if (target.pestTestName) {
    return `~${escapeRegex(target.pestTestName)}~i`;
  }
  if (target.className && target.methodName) {
    return `~^${escapeRegex(target.className)}::${escapeRegex(target.methodName)}(?: with data set .*)?$~i`;
  }
  if (target.className) {
    return `~^${escapeRegex(target.className)}(?:::.*)?$~i`;
  }
  return undefined;
}

async function parseRunnerCommand(value: string, cwd: string): Promise<ParsedRunnerCommand> {
  const trimmed = value.trim();
  if (!trimmed) {
    return { command: trimmed, args: [] };
  }

  // Keep an existing path as one executable even when it contains spaces and is unquoted.
  if (await commandPathExists(trimmed, cwd) || isRecognizedRunnerCommand(trimmed)) {
    return { command: trimmed, args: [] };
  }

  const words = splitCommandLine(trimmed);
  if (words.length <= 1) {
    return { command: words[0] ?? '', args: [] };
  }

  // Recover unquoted executable paths with spaces when followed by arguments.
  for (let wordCount = words.length - 1; wordCount > 0; wordCount -= 1) {
    const candidate = words.slice(0, wordCount).join(' ');
    if (await commandPathExists(candidate, cwd) || isRecognizedRunnerCommand(candidate)) {
      return { command: candidate, args: words.slice(wordCount) };
    }
  }

  return { command: words[0], args: words.slice(1) };
}

async function commandPathExists(candidate: string, cwd: string): Promise<boolean> {
  if (process.platform !== 'win32' && isWindowsAbsoluteCommandPath(candidate)) {
    return false;
  }
  if (!candidate || (!path.isAbsolute(candidate) && !candidate.includes('/') && !candidate.includes('\\'))) {
    return false;
  }

  try {
    await fs.access(resolvePath(cwd, candidate));
    return true;
  } catch {
    return false;
  }
}

function isWindowsAbsoluteCommandPath(candidate: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(candidate) || /^\\\\[^\\]+\\[^\\]+/.test(candidate);
}

function splitCommandLine(value: string): string[] {
  const words: string[] = [];
  let word = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let wordStarted = false;

  const finishWord = () => {
    if (wordStarted) {
      words.push(word);
      word = '';
      wordStarted = false;
    }
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];

    if (escaped) {
      word += character;
      wordStarted = true;
      escaped = false;
      continue;
    }

    if (quote === "'") {
      if (character === "'") {
        quote = undefined;
      } else {
        word += character;
      }
      wordStarted = true;
      continue;
    }

    if (quote === '"') {
      if (character === '"') {
        quote = undefined;
      } else if (character === '\\' && next === '"') {
        escaped = true;
      } else {
        word += character;
      }
      wordStarted = true;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      wordStarted = true;
    } else if (character === '\\' && next && (/[\s'"]/.test(next))) {
      escaped = true;
      wordStarted = true;
    } else if (/\s/.test(character)) {
      finishWord();
    } else {
      word += character;
      wordStarted = true;
    }
  }

  if (quote) {
    throw new Error('phpunitRunner.phpunitCommand contains an unterminated quote.');
  }
  if (escaped) {
    word += '\\';
  }
  finishWord();
  return words;
}

function isPhpBinary(command: string): boolean {
  return /^php(?:\d+(?:\.\d+)*)?(?:\.exe)?$/i.test(runnerBasename(command));
}

function isRecognizedRunnerCommand(command: string): boolean {
  return isPhpBinary(command)
    || isPhpRunnerScript(command)
    || /^(?:phpunit|pest|paratest)(?:\.(?:bat|cmd|exe))?$/i.test(runnerBasename(command));
}

function isPhpRunnerScript(command: string): boolean {
  return isPhpScript(command) || /^(?:artisan(?:\.php)?|phpunit|pest|paratest)$/i.test(runnerBasename(command));
}

function runnerBasename(command: string): string {
  return command.includes('\\') ? path.win32.basename(command) : path.basename(command);
}

export function resolveDockerInvocation(
  workspacePath: string,
  config: RunnerConfig,
  invocation: Invocation,
  debug = false,
): Invocation {
  const dockerCommandParts = splitCommandLine(config.dockerCommand.trim() || 'docker');
  const dockerCommand = dockerCommandParts[0] || 'docker';
  const dockerCommandArgs = dockerCommandParts.slice(1);
  const container = config.dockerContainer.trim();
  if (!container) {
    throw new Error('phpunitRunner.docker.container must be set when docker execution is enabled.');
  }

  const pathMappings = resolveDockerPathMappings(workspacePath, config, invocation.mappings ?? []);
  const containerCwd = mapWithMappings(invocation.cwd, pathMappings);
  const containerCommand = mapWithMappings(invocation.command, pathMappings);
  const containerArgs = invocation.args.map((arg) => mapWithMappings(arg, pathMappings));
  const debugEnv = debug
    ? ['-e', 'XDEBUG_TRIGGER=1', '-e', 'XDEBUG_SESSION=1']
    : [];

  return {
    command: dockerCommand,
    args: [...dockerCommandArgs, 'exec', '-i', ...debugEnv, ...config.dockerExecArgs, '-w', containerCwd, container, containerCommand, ...containerArgs],
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
  const mappedPhpArgs = options.phpArgs.map((arg) => mapWithMappings(arg, options.mappings));
  const mappedPhpunitArgs = options.phpunitArgs.map((arg) => mapWithMappings(arg, options.mappings));
  const phpunitxmlIndex = mappedPhpunitArgs.indexOf('--configuration');
  const phpunitxml = phpunitxmlIndex >= 0 ? mappedPhpunitArgs[phpunitxmlIndex + 1] ?? '' : '';
  const quotedVars = Object.fromEntries(
    Object.entries(options.vars).map(([name, value]) => [name, quoteTemplateShellArg(value)]),
  );

  const rendered = substituteVariables(options.template, {
    ...quotedVars,
    php: quoteTemplateShellArg(php),
    phpargs: joinTemplateShellArgs(mappedPhpArgs),
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

function resolveDockerPathMappings(
  workspacePath: string,
  config: RunnerConfig,
  configuredMappings: PathMapping[],
): PathMapping[] {
  const normalizedWorkspacePath = normalizeDockerPath(workspacePath);
  const workspaceIsCovered = configuredMappings.some(({ from }) => {
    const normalizedFrom = normalizeDockerPath(from);
    return normalizedWorkspacePath === normalizedFrom
      || normalizedWorkspacePath.startsWith(`${normalizedFrom}/`);
  });
  const mappings = workspaceIsCovered
    ? [...configuredMappings]
    : [...configuredMappings, ...dockerMappings(workspacePath, config)];
  return mappings.sort((left, right) => right.from.length - left.from.length);
}

function normalizeDockerPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}
