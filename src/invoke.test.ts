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
  dockerEnable: false,
  dockerCommand: 'docker',
  dockerContainer: 'app',
  dockerWorkspacePath: '/var/www/html',
  dockerExecArgs: ['-u', 'www-data'],
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
    assert.ok(invocation.args.includes('/var/www/html/vendor/bin/phpunit'));
    assert.ok(invocation.args.includes('/var/www/html/tests/ExampleTest.php'));
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
