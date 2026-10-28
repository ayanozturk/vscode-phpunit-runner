import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDockerInvocation, resolveInvocation } from './invoke';
import { mapHostPathToContainer } from './paths';
import type { RunnerConfig, TestTarget } from './types';

const config: RunnerConfig = {
  phpExecutable: 'php',
  phpunitCommand: '/proj/vendor/bin/phpunit',
  configurationFile: '',
  workingDirectory: '',
  additionalArgs: ['--testdox'],
  phpArgs: [],
  command: '',
  paths: {},
  environment: {},
  saveBeforeTest: false,
  dockerEnable: false,
  dockerCommand: 'docker',
  dockerContainer: 'app',
  dockerWorkspacePath: '/var/www/html',
  dockerExecArgs: ['-u', 'www-data'],
  debuggerConfig: '',
  xdebugPort: 9003,
};

const fileTarget: TestTarget = {
  kind: 'file',
  filePath: '/proj/tests/ExampleTest.php',
};

const methodTarget: TestTarget = {
  kind: 'method',
  filePath: '/proj/tests/ExampleTest.php',
  className: 'App\\Tests\\ExampleTest',
  methodName: 'testItWorks',
};

describe('resolveInvocation', () => {
  it('runs phpunit as a php script with junit logging and auto config', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config,
      junitLogPath: '/proj/.phpunit-runner/junit.xml',
      phpunitExecutable: '/proj/vendor/bin/phpunit',
      detectedConfigurationFile: '/proj/phpunit.xml',
    });

    assert.equal(invocation.command, 'php');
    assert.deepEqual(invocation.args, [
      '/proj/vendor/bin/phpunit',
      '--configuration',
      '/proj/phpunit.xml',
      '--colors=always',
      '--testdox',
      '--log-junit',
      '/proj/.phpunit-runner/junit.xml',
      '/proj/tests/ExampleTest.php',
    ]);
  });

  it('filters a single method and maps docker exec paths', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: methodTarget,
      config: { ...config, dockerEnable: true },
      phpunitExecutable: '/proj/vendor/bin/phpunit',
      detectedConfigurationFile: 'phpunit.xml',
    });

    assert.equal(invocation.command, 'docker');
    assert.equal(invocation.args[0], 'exec');
    assert.ok(invocation.args.includes('-u'));
    assert.ok(invocation.args.includes('--filter'));
    assert.ok(invocation.args.some((arg) => arg.includes('ExampleTest::testItWorks')));
    assert.ok(invocation.args.some((arg) => arg.includes('with data set .*|#.*|@.*')));
    assert.ok(invocation.args.includes('/var/www/html/vendor/bin/phpunit'));
    assert.ok(invocation.args.includes('/var/www/html/tests/ExampleTest.php'));
  });

  it('filters a selected data set using its complete PHPUnit case name', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: {
        kind: 'dataset',
        className: 'App\\Tests\\ExampleTest',
        methodName: 'testAdd',
        datasetName: 'testAdd with data set "zeros"',
      },
      config,
    });

    const filterIndex = invocation.args.indexOf('--filter');
    assert.ok(filterIndex >= 0);
    assert.match(invocation.args[filterIndex + 1], /ExampleTest::testAdd with data set "zeros"/);
  });

  it('adds debug, coverage, and group flags and omits a file when running a group', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: { kind: 'file', group: 'unit' },
      config,
      phpunitExecutable: '/proj/vendor/bin/phpunit',
      detectedConfigurationFile: '/proj/phpunit.xml',
      coverageCloverPath: '/proj/.phpunit-runner/clover.xml',
      debug: true,
    });

    assert.ok(invocation.args.includes('-dxdebug.mode=debug'));
    assert.ok(invocation.args.includes('--coverage-clover'));
    assert.ok(invocation.args.includes('--group'));
    assert.ok(invocation.args.includes('unit'));
    assert.ok(!invocation.args.includes(undefined as unknown as string));
    assert.equal(invocation.args.at(-1), 'unit');
  });

  it('renders a Sail-style command template with path mappings', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config: {
        ...config,
        command: 'docker compose exec -u sail laravel.test ${php} ${phpargs} ${phpunit} ${phpunitargs}',
        paths: { '${workspaceFolder}': '/var/www/html' },
        environment: { APP_ENV: 'testing' },
      },
      phpunitExecutable: '/proj/vendor/bin/phpunit',
      detectedConfigurationFile: '/proj/phpunit.xml',
      junitLogPath: '/proj/.phpunit-runner/junit.xml',
      userHome: '/home/dev',
    });

    assert.equal(invocation.shell, true);
    assert.equal(invocation.env?.APP_ENV, 'testing');
    assert.match(invocation.command, /docker compose exec -u sail laravel.test php/);
    assert.match(invocation.command, /\/var\/www\/html\/vendor\/bin\/phpunit/);
    assert.match(invocation.command, /\/var\/www\/html\/tests\/ExampleTest.php/);
    assert.ok(!invocation.command.includes('/proj/vendor/bin/phpunit'));
  });

  it('quotes mapped report and test paths in SSH templates', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/workspace folder/$HOME',
      target: { kind: 'file', filePath: '/workspace folder/$HOME/tests/Spec Test.php' },
      config: {
        ...config,
        phpunitCommand: '/workspace folder/$HOME/vendor/bin/phpunit',
        command: 'ssh user@host "cd ${cwd} && ${php} ${phpunit} ${phpunitargs}"',
        paths: { '${workspaceFolder}': '/srv/app' },
      },
      phpunitExecutable: '/workspace folder/$HOME/vendor/bin/phpunit',
      junitLogPath: '/workspace folder/$HOME/.phpunit-runner/junit report.xml',
    });

    assert.match(invocation.command, /cd \/srv\/app/);
    assert.ok(invocation.command.includes("'/srv/app/tests/Spec Test.php'"));
    assert.ok(invocation.command.includes("'/srv/app/.phpunit-runner/junit report.xml'"));
    assert.ok(!invocation.command.includes('$HOME'));
  });

  it('prefers a command template over docker.enable wrapping', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config: {
        ...config,
        dockerEnable: true,
        dockerContainer: 'app',
        command: 'ddev exec ${php} ${phpunit} ${phpunitargs}',
      },
      phpunitExecutable: '/proj/vendor/bin/phpunit',
      detectedConfigurationFile: '/proj/phpunit.xml',
    });

    assert.equal(invocation.shell, true);
    assert.match(invocation.command, /^ddev exec /);
    assert.ok(!invocation.args.includes('exec'));
  });

  it('throws when docker is enabled without a container', () => {
    assert.throws(() => resolveDockerInvocation('/proj', { ...config, dockerContainer: '' }, {
      command: 'php',
      args: [],
      cwd: '/proj',
    }), /docker.container/);
  });
});

describe('mapHostPathToContainer', () => {
  it('rewrites workspace-relative paths only', () => {
    assert.equal(
      mapHostPathToContainer('/proj/tests/A.php', '/proj', '/app'),
      '/app/tests/A.php',
    );
    assert.equal(mapHostPathToContainer('--colors=always', '/proj', '/app'), '--colors=always');
  });
});
