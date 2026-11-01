import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { describe, it } from 'node:test';
import { autoDetectConfigurationFile, autoDetectPhpUnit, resolveDockerInvocation, resolveInvocation } from './invoke';
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

describe('autoDetectPhpUnit', () => {
  it('prefers the Composer binary over a project-local PHAR', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit detection precedence '));
    try {
      const composerBinary = path.join(workspace, 'vendor', 'bin', 'phpunit');
      const phar = path.join(workspace, 'phpunit.phar');
      await fs.mkdir(path.dirname(composerBinary), { recursive: true });
      await fs.writeFile(composerBinary, '');
      await fs.writeFile(phar, '');

      assert.equal(await autoDetectPhpUnit(workspace, 'linux'), composerBinary);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('uses a project-local PHAR when the Composer binary is absent and otherwise falls back to PATH', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit detection phar '));
    try {
      const phar = path.join(workspace, 'phpunit.phar');
      await fs.writeFile(phar, '');
      assert.equal(await autoDetectPhpUnit(workspace, 'linux'), phar);

      await fs.rm(phar);
      assert.equal(await autoDetectPhpUnit(workspace, 'linux'), 'phpunit');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('detects and launches a project-local PHAR on Windows when Composer proxies are absent', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit windows phar '));
    try {
      const phar = path.join(workspace, 'phpunit.phar');
      await fs.writeFile(phar, '');
      const detected = await autoDetectPhpUnit(workspace, 'win32');
      assert.equal(detected, phar);

      const invocation = await resolveInvocation({
        workspacePath: workspace,
        target: fileTarget,
        config: { ...config, phpunitCommand: '' },
        phpunitExecutable: detected,
      });
      assert.equal(invocation.command, 'php');
      assert.equal(invocation.args[0], phar);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('autoDetectConfigurationFile', () => {
  it('prefers phpunit.xml over the distribution file and returns undefined when neither exists', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit config detection '));
    try {
      const standardConfig = path.join(workspace, 'phpunit.xml');
      const distributionConfig = path.join(workspace, 'phpunit.xml.dist');
      await fs.writeFile(distributionConfig, '<phpunit/>');
      assert.equal(await autoDetectConfigurationFile(workspace), distributionConfig);

      await fs.writeFile(standardConfig, '<phpunit/>');
      assert.equal(await autoDetectConfigurationFile(workspace), standardConfig);

      await fs.rm(standardConfig);
      await fs.rm(distributionConfig);
      assert.equal(await autoDetectConfigurationFile(workspace), undefined);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('resolveInvocation', () => {
  it('passes every selected test file path to one PHPUnit invocation', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: { kind: 'file', filePaths: ['/proj/tests/ApiTest.php', '/proj/tests/AuthTest.php'] },
      config,
      phpunitExecutable: '/proj/vendor/bin/phpunit',
    });

    assert.deepEqual(invocation.args.slice(-2), ['/proj/tests/ApiTest.php', '/proj/tests/AuthTest.php']);
  });

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

  it('adds the optional JSONL coverage directory only when explicitly supported', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config,
      phpunitExecutable: '/proj/vendor/bin/phpunit',
      coverageCloverPath: '/proj/.phpunit-runner/clover.xml',
      coverageJsonlDirectory: '/proj/.phpunit-runner/coverage-jsonl',
    });

    const cloverIndex = invocation.args.indexOf('--coverage-clover');
    const jsonlIndex = invocation.args.indexOf('--coverage-jsonl');
    assert.ok(cloverIndex >= 0 && jsonlIndex > cloverIndex);
    assert.deepEqual(invocation.args.slice(jsonlIndex, jsonlIndex + 2), [
      '--coverage-jsonl',
      '/proj/.phpunit-runner/coverage-jsonl',
    ]);
    assert.equal(invocation.args.at(-1), '/proj/tests/ExampleTest.php');
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
    const filterIndex = invocation.args.indexOf('--filter');
    assert.equal(invocation.args[filterIndex + 1], '~^App\\\\Tests\\\\ExampleTest::testItWorks(?: with data set .*)?$~i');
    assert.ok(invocation.args.includes('/var/www/html/vendor/bin/phpunit'));
    assert.ok(invocation.args.includes('/var/www/html/tests/ExampleTest.php'));
  });

  it('filters a selected test class when no method is selected', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: { kind: 'class', className: 'App\\Tests\\ExampleTest' },
      config,
      phpunitExecutable: '/proj/vendor/bin/phpunit',
    });

    const filterIndex = invocation.args.indexOf('--filter');
    assert.ok(filterIndex >= 0);
    assert.equal(invocation.args[filterIndex + 1], '~^App\\\\Tests\\\\ExampleTest(?:::.*)?$~i');
  });

  it('runs an Artisan-style multi-word command through PHP and preserves runner options', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: methodTarget,
      config: {
        ...config,
        phpunitCommand: 'artisan test --parallel --processes=4',
        phpArgs: ['-d', 'memory_limit=2G'],
      },
    });

    assert.equal(invocation.command, 'php');
    assert.deepEqual(invocation.args.slice(0, 5), [
      '-d', 'memory_limit=2G', 'artisan', 'test', '--parallel',
    ]);
    assert.ok(invocation.args.includes('--processes=4'));
    assert.ok(invocation.args.includes('--filter'));
    assert.ok(invocation.args.includes('/proj/tests/ExampleTest.php'));
  });

  it('accepts an explicit PHP command before an application runner', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config: { ...config, phpunitCommand: 'php artisan test' },
    });

    assert.equal(invocation.command, 'php');
    assert.deepEqual(invocation.args.slice(0, 3), ['artisan', 'test', '--colors=always']);
  });

  it('recognizes a Windows PHP executable path followed by an application runner', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config: { ...config, phpunitCommand: 'C:\\Tools\\PHP Folder\\php.exe artisan test' },
    });

    assert.equal(invocation.command, 'C:\\Tools\\PHP Folder\\php.exe');
    assert.deepEqual(invocation.args.slice(0, 3), ['artisan', 'test', '--colors=always']);
  });

  it('preserves standalone Windows batch commands and their options', async () => {
    for (const runner of ['phpunit', 'pest']) {
      const invocation = await resolveInvocation({
        workspacePath: '/proj',
        target: fileTarget,
        config: { ...config, phpunitCommand: '' },
        phpunitExecutable: `C:\\project\\vendor\\bin\\${runner}.bat --no-coverage`,
      });

      assert.equal(invocation.command, `C:\\project\\vendor\\bin\\${runner}.bat`);
      assert.equal(invocation.args[0], '--no-coverage');
    }
  });

  it('prefers the extensionless Windows Composer proxy and launches it through PHP', async () => {
    for (const runner of ['phpunit', 'pest']) {
      const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit windows proxy '));
      try {
        if (runner === 'pest') {
          await fs.writeFile(path.join(workspace, 'composer.json'), JSON.stringify({
            'require-dev': { 'pestphp/pest': '^3.0' },
          }));
        }
        const proxyPath = path.join(workspace, `vendor\\bin\\${runner}`);
        await fs.writeFile(proxyPath, '');
        await fs.writeFile(`${proxyPath}.bat`, '');

        const detected = await autoDetectPhpUnit(workspace, 'win32');
        assert.equal(detected, proxyPath);

        const invocation = await resolveInvocation({
          workspacePath: workspace,
          target: fileTarget,
          config,
          phpunitExecutable: detected,
        });
        assert.equal(invocation.command, 'php');
        assert.equal(invocation.args[0], proxyPath);
      } finally {
        await fs.rm(workspace, { recursive: true, force: true });
      }
    }
  });

  it('launches the extensionless ParaTest Composer proxy through PHP when its batch sibling exists', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit paratest proxy '));
    try {
      const proxyPath = path.join(workspace, 'vendor\\bin\\paratest');
      await fs.writeFile(proxyPath, '');
      await fs.writeFile(`${proxyPath}.bat`, '');

      const invocation = await resolveInvocation({
        workspacePath: workspace,
        target: fileTarget,
        config: { ...config, phpunitCommand: '' },
        phpunitExecutable: proxyPath,
      });

      assert.equal(invocation.command, 'php');
      assert.equal(invocation.args[0], proxyPath);
      assert.ok(invocation.args.includes('--colors=always'));
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('keeps command arguments separate and honors quotes around an argument with spaces', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config: {
        ...config,
        phpunitCommand: 'vendor/bin/paratest --testsuite "Integration Suite" --processes=3',
      },
    });

    assert.equal(invocation.command, 'php');
    assert.deepEqual(invocation.args.slice(0, 4), [
      'vendor/bin/paratest', '--testsuite', 'Integration Suite', '--processes=3',
    ]);
  });

  it('keeps shell metacharacters inside a quoted runner argument', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config: {
        ...config,
        phpunitCommand: 'vendor/bin/paratest --testsuite "Integration & Legacy"',
      },
    });

    assert.equal(invocation.command, 'php');
    assert.deepEqual(invocation.args.slice(0, 3), [
      'vendor/bin/paratest', '--testsuite', 'Integration & Legacy',
    ]);
  });

  it('preserves an unquoted executable path with spaces when options follow it', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/workspace folder',
      target: fileTarget,
      config: {
        ...config,
        phpunitCommand: '/workspace folder/vendor/bin/phpunit --no-coverage',
      },
    });

    assert.equal(invocation.command, 'php');
    assert.equal(invocation.args[0], '/workspace folder/vendor/bin/phpunit');
    assert.equal(invocation.args[1], '--no-coverage');
  });

  it('finds an existing POSIX executable path with spaces before parsing its arguments', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit runner '));
    try {
      const executable = path.join(workspace, 'custom runner');
      await fs.writeFile(executable, '');
      const invocation = await resolveInvocation({
        workspacePath: workspace,
        target: fileTarget,
        config: {
          ...config,
          phpunitCommand: `${executable} --label "Integration Suite"`,
        },
      });

      assert.equal(invocation.command, executable);
      assert.deepEqual(invocation.args.slice(0, 2), ['--label', 'Integration Suite']);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('maps an Artisan-style command through Docker and keeps command options', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: methodTarget,
      config: {
        ...config,
        phpunitCommand: 'artisan test --parallel',
        dockerEnable: true,
      },
    });

    assert.equal(invocation.command, 'docker');
    assert.ok(invocation.args.includes('php'));
    assert.ok(invocation.args.includes('artisan'));
    assert.ok(invocation.args.includes('test'));
    assert.ok(invocation.args.includes('--parallel'));
    assert.ok(invocation.args.includes('/var/www/html/tests/ExampleTest.php'));
  });

  it('supports Docker Compose as a multi-word Docker command', () => {
    const invocation = resolveDockerInvocation('/proj', {
      ...config,
      dockerCommand: 'docker compose',
    }, {
      command: 'php',
      args: ['vendor/bin/phpunit'],
      cwd: '/proj',
    });

    assert.equal(invocation.command, 'docker');
    assert.deepEqual(invocation.args.slice(0, 3), ['compose', 'exec', '-i']);
    assert.ok(invocation.args.includes('app'));
  });

  it('preserves a quoted Docker executable path containing spaces', () => {
    const invocation = resolveDockerInvocation('/proj', {
      ...config,
      dockerCommand: '"/opt/Docker Tools/docker"',
    }, {
      command: 'php',
      args: ['vendor/bin/phpunit'],
      cwd: '/proj',
    });

    assert.equal(invocation.command, '/opt/Docker Tools/docker');
    assert.equal(invocation.args[0], 'exec');
  });

  it('maps distinct workspace roots into one shared Docker container with per-root commands', async () => {
    const workspaceMappings = {
      '/work/api': '/srv/apps/api',
      '/work/web': '/srv/apps/web',
    };
    const apiInvocation = await resolveInvocation({
      workspacePath: '/work/api',
      target: { ...fileTarget, filePath: '/work/api/tests/ApiTest.php' },
      config: {
        ...config,
        dockerEnable: true,
        dockerContainer: 'shared-php',
        dockerWorkspacePath: '',
        paths: workspaceMappings,
        phpunitCommand: '/work/api/vendor/bin/phpunit',
      },
    });
    const webInvocation = await resolveInvocation({
      workspacePath: '/work/web',
      target: { ...fileTarget, filePath: '/work/web/tests/WebTest.php' },
      config: {
        ...config,
        dockerEnable: true,
        dockerContainer: 'shared-php',
        dockerWorkspacePath: '/container/fallback',
        dockerExecArgs: ['-u', 'frontend'],
        additionalArgs: ['--parallel'],
        paths: workspaceMappings,
        phpunitCommand: 'artisan test --compact',
      },
    });

    assert.deepEqual(apiInvocation.args.slice(0, 8), [
      'exec', '-i', '-u', 'www-data', '-w', '/srv/apps/api', 'shared-php', 'php',
    ]);
    assert.ok(apiInvocation.args.includes('/srv/apps/api/vendor/bin/phpunit'));
    assert.ok(apiInvocation.args.includes('/srv/apps/api/tests/ApiTest.php'));
    assert.equal(apiInvocation.mappings?.find(({ from }) => from === '/work/api')?.to, '/srv/apps/api');
    assert.equal(apiInvocation.mappings?.find(({ from }) => from === '/work/web')?.to, '/srv/apps/web');

    assert.equal(webInvocation.args[2], '-u');
    assert.equal(webInvocation.args[3], 'frontend');
    assert.ok(webInvocation.args.includes('/srv/apps/web'));
    assert.ok(webInvocation.args.includes('shared-php'));
    assert.ok(webInvocation.args.includes('artisan'));
    assert.ok(webInvocation.args.includes('test'));
    assert.ok(webInvocation.args.includes('--compact'));
    assert.ok(webInvocation.args.includes('--parallel'));
    assert.ok(webInvocation.args.includes('/srv/apps/web/tests/WebTest.php'));
    assert.equal(webInvocation.mappings?.find(({ from }) => from === '/work/web')?.to, '/srv/apps/web');
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
    assert.equal(invocation.args[filterIndex + 1], '~^App\\\\Tests\\\\ExampleTest::testAdd with data set "zeros"$~i');
  });

  it('escapes regex metacharacters and the PHPUnit filter delimiter in named data sets', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: {
        kind: 'dataset',
        className: 'App\\Tests\\ExampleTest',
        methodName: 'testFind',
        datasetName: 'testFind with data set "a+b~c[1]"',
      },
      config,
      phpunitExecutable: '/proj/vendor/bin/phpunit',
    });

    const filterIndex = invocation.args.indexOf('--filter');
    assert.ok(filterIndex >= 0);
    assert.equal(
      invocation.args[filterIndex + 1],
      '~^App\\\\Tests\\\\ExampleTest::testFind with data set "a\\+b\\~c\\[1\\]"$~i',
      'literal data-set names cannot alter the PHPUnit regex or terminate its ~ delimiter',
    );
  });

  it('filters a selected Pest data set by its complete case name', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: {
        kind: 'method',
        filePath: '/proj/tests/ValuesTest.php',
        className: 'Pest tests\\root',
        methodName: 'adds values (with data set #0)',
        pestTestName: 'adds values with data set #0',
        pestDatasetName: 'with data set #0',
      },
      config,
      phpunitExecutable: '/proj/vendor/bin/pest',
    });

    const filterIndex = invocation.args.indexOf('--filter');
    assert.ok(filterIndex >= 0);
    assert.equal(invocation.args[filterIndex + 1], '~adds values with data set #0~i');
    assert.ok(invocation.args.includes('/proj/tests/ValuesTest.php'));
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

  it('keeps aggregate Clover coverage when optional per-test coverage is unavailable', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config,
      phpunitExecutable: '/proj/vendor/bin/phpunit',
      coverageCloverPath: '/proj/.phpunit-runner/clover.xml',
    });

    const cloverIndex = invocation.args.indexOf('--coverage-clover');
    assert.ok(cloverIndex >= 0);
    assert.equal(invocation.args[cloverIndex + 1], '/proj/.phpunit-runner/clover.xml');
    assert.equal(invocation.args.includes('--coverage-jsonl'), false,
      'per-test details are not requested without an explicitly supported JSONL report');
  });

  it('requests a machine-readable runtime test listing without selecting or executing tests', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: { kind: 'file' },
      config,
      phpunitExecutable: '/proj/vendor/bin/phpunit',
      testListingXmlPath: '/proj/.phpunit-runner/listing.xml',
    });

    const listingIndex = invocation.args.indexOf('--list-tests-xml');
    assert.ok(listingIndex >= 0);
    assert.equal(invocation.args[listingIndex + 1], '/proj/.phpunit-runner/listing.xml');
    assert.ok(!invocation.args.includes('--filter'));
    assert.ok(!invocation.args.includes('--log-junit'));
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

  it('maps absolute PHP runtime arguments in remote command templates', async () => {
    const invocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config: {
        ...config,
        phpArgs: ['-c', '/proj/config/php.ini', '-d', 'memory_limit=2G'],
        command: 'ssh host ${php} ${phpargs} ${phpunit} ${phpunitargs}',
        paths: { '${workspaceFolder}': '/srv/app' },
      },
      phpunitExecutable: '/proj/vendor/bin/phpunit',
    });

    assert.ok(invocation.command.includes('-c /srv/app/config/php.ini'));
    assert.ok(invocation.command.includes('-d memory_limit=2G'));
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

  it('adds one runner-specific parallel configuration while preserving the test filter', async () => {
    const pestInvocation = await resolveInvocation({
      workspacePath: '/proj',
      target: methodTarget,
      config: { ...config, additionalArgs: ['--processes=9', '--processes', '11', '--parallel=false', '--testdox'] },
      phpunitExecutable: 'vendor/bin/pest',
      parallelRunner: 'pest',
      parallelProcesses: 3,
    });
    const filterIndex = pestInvocation.args.indexOf('--filter');
    assert.deepEqual(pestInvocation.args.slice(filterIndex), [
      '--filter', '~^App\\\\Tests\\\\ExampleTest::testItWorks(?: with data set .*)?$~i', '/proj/tests/ExampleTest.php',
    ]);
    assert.ok(pestInvocation.args.includes('--parallel'));
    assert.ok(pestInvocation.args.includes('--processes=3'));
    assert.ok(pestInvocation.args.includes('--testdox'));
    assert.ok(!pestInvocation.args.includes('--parallel=false'));
    assert.ok(!pestInvocation.args.includes('9'));
    assert.ok(!pestInvocation.args.includes('11'));
    assert.equal(pestInvocation.args.filter((argument) => argument === '--parallel').length, 1);
    assert.equal(pestInvocation.args.filter((argument) => argument.startsWith('--processes=')).length, 1);

    const paratestInvocation = await resolveInvocation({
      workspacePath: '/proj',
      target: fileTarget,
      config,
      phpunitExecutable: 'vendor/bin/paratest',
      parallelRunner: 'paratest',
      parallelProcesses: 4,
    });
    assert.ok(paratestInvocation.args.includes('--processes=4'));
    assert.ok(!paratestInvocation.args.includes('--parallel'));
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
