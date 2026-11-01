const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function until(predicate, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  assert.fail(message);
}

function flatten(items) {
  return [...items].flatMap(([, item]) => [item, ...flatten(item.children)]);
}

function captureRunEvents(controller, events, coverages = [], outputs = [], outputEvents = []) {
  const original = controller.createTestRun;
  controller.createTestRun = function (...args) {
    const run = original.apply(controller, args);
    return new Proxy(run, {
      get(target, property) {
        const method = Reflect.get(target, property, target);
        if (['started', 'passed', 'failed', 'skipped', 'errored'].includes(property)) {
          return (item, ...rest) => {
            events.push({ state: property, id: item.id, label: item.label });
            return method.call(target, item, ...rest);
          };
        }
        if (property === 'addCoverage') {
          return (coverage) => {
            coverages.push(coverage);
            return method.call(target, coverage);
          };
        }
        if (property === 'appendOutput') {
          return (output, ...rest) => {
            outputs.push(output);
            outputEvents.push({ output, location: rest[0] });
            return method.call(target, output, ...rest);
          };
        }
        return typeof method === 'function' ? method.bind(target) : method;
      },
    });
  };
  return () => { controller.createTestRun = original; };
}

exports.run = async () => {
  try {
    const extension = vscode.extensions.all.find((item) => item.packageJSON.name === 'aos-phpunit');
    assert.ok(extension, 'PHPUnit Runner extension is loaded');
    const outputClears = [];
    const diagnosticOutput = [];
    const originalCreateOutputChannel = vscode.window.createOutputChannel;
    vscode.window.createOutputChannel = function (...args) {
      const channel = originalCreateOutputChannel.apply(this, args);
      if (args[0] !== 'PHPUnit Runner') return channel;
      return new Proxy(channel, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (property === 'clear') {
            return (...clearArgs) => {
              outputClears.push(clearArgs);
              return value.apply(target, clearArgs);
            };
          }
          if (property === 'appendLine') {
            return (line) => {
              diagnosticOutput.push(line);
              return value.call(target, line);
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const api = await extension.activate();
    vscode.window.createOutputChannel = originalCreateOutputChannel;
    assert.ok(api && api.controller, 'test-mode activation exposes the controller');

    const commands = new Set(await vscode.commands.getCommands(true));
    assert.ok(commands.has('phpunitRunner.refreshTests'));
    assert.ok(commands.has('phpunitRunner.runByGroup'));
    assert.ok(commands.has('phpunitRunner.diagnoseProject'));
    assert.ok(commands.has('phpunitRunner.showTestInsights'));
    assert.ok(commands.has('phpunitRunner.clearTestInsights'));

    const workspaceA = vscode.workspace.workspaceFolders.find((folder) => folder.name === 'workspace-a');
    const workspaceB = vscode.workspace.workspaceFolders.find((folder) => folder.name === 'workspace-b');
    assert.ok(workspaceA && workspaceB, 'fixture opens as a multi-root workspace');

    for (const [folder, className, methodName] of [
      [workspaceA, 'AlphaTest', 'testAlpha'],
      [workspaceB, 'BetaTest', 'testBeta'],
    ]) {
      const runner = path.join(folder.uri.fsPath, 'fake-phpunit');
      const runLog = path.join(folder.uri.fsPath, 'runner.log');
      const runnerSource = [
        '#!/bin/sh',
        'if [ "$PHPUNIT_RUNNER_MODE" = "hang" ]; then',
        '  touch "' + folder.uri.fsPath + '/runner-ready"',
        '  while true; do sleep 1; done',
        'fi',
        'echo "invoked $@" >> "' + runLog + '"',
        'report=""',
        'coverage=""',
        'listing=""',
        'previous=""',
        'testcaseName="' + methodName + '"',
        'testcaseClass="' + className + '"',
        'testcaseFile="tests/' + className + '.php"',
        'additionalCase=""',
        'for argument in "$@"; do',
        '  if [ "$previous" = "report" ]; then report="$argument"; previous=""; continue; fi',
        '  if [ "$previous" = "coverage" ]; then coverage="$argument"; previous=""; continue; fi',
        '  if [ "$previous" = "listing" ]; then listing="$argument"; previous=""; continue; fi',
        '  if [ "$previous" = "filter" ]; then',
        '    case "$argument" in',
        '      *"generated values"*) testcaseName=\'generated values with data set "first"\';;',
        '      *"TestDoxTest::testRawMethodName"*) testcaseName=\'testRawMethodName\'; testcaseClass=\'TestDoxTest\'; testcaseFile=\'tests/TestDoxTest.php\';;',
        "      *'DataProviderTest::testPairs with data set \"positive pair\"'*) testcaseName='testPairs with data set &quot;positive pair&quot;'; testcaseClass='DataProviderTest'; testcaseFile='tests/DataProviderTest.php';;",
        "      *'DynamicDataProviderTest::testDynamic with data set \"runtime named\"'*) testcaseName='testDynamic with data set &quot;runtime named&quot;'; testcaseClass='DynamicDataProviderTest'; testcaseFile='tests/DynamicDataProviderTest.php';;",
        '      *"TestWithTest::testWithRows with data set #0"*) testcaseName=\'testWithRows with data set #0\'; testcaseClass=\'TestWithTest\'; testcaseFile=\'tests/TestWithTest.php\';;',
        "      *'TestWithTest::testWithRows with data set \"positive pair\"'*) testcaseName='testWithRows with data set &quot;positive pair&quot;'; testcaseClass='TestWithTest'; testcaseFile='tests/TestWithTest.php';;",
        "      *'TestWithJsonTest::testJsonRows with data set \"json named\"'*) testcaseName='testJsonRows with data set &quot;json named&quot;'; testcaseClass='TestWithJsonTest'; testcaseFile='tests/TestWithJsonTest.php';;",
        '    esac',
        '    previous=""',
        '    continue',
        '  fi',
        '  if [ "$argument" = "--log-junit" ]; then previous="report"; fi',
        '  if [ "$argument" = "--coverage-clover" ]; then previous="coverage"; fi',
        '  if [ "$argument" = "--list-tests-xml" ]; then previous="listing"; fi',
        '  if [ "$argument" = "--filter" ]; then previous="filter"; fi',
        '  case "$argument" in *ValuesTest.php) testcaseFile="tests/ValuesTest.php"; additionalCase="<testcase name=\'testValues\' classname=\'ValuesTest\' file=\'tests/ValuesTest.php\' time=\'0.02\'/>";; esac',
        'done',
        'if [ -n "$listing" ]; then',
        '  if [ "$RUNTIME_DATASET_MODE" = "empty" ]; then',
        '    cat > "$listing" <<XML',
        '<tests><testCaseClass name="DynamicDataProviderTest" /></tests>',
        'XML',
        '  else',
        '    cat > "$listing" <<XML',
        '<tests><testCaseClass name="DynamicDataProviderTest"><testCaseMethod name="testDynamic with data set &quot;runtime named&quot;" groups="unit" /></testCaseClass></tests>',
        'XML',
        '  fi',
        '  exit 0',
        'fi',
        'if [ "$PHPUNIT_RUNNER_MODE" = "summary" ]; then',
        '  cat > "$report" <<XML',
        "<testsuites><testsuite><testcase name='testAlpha' classname='" + className + "' file='tests/" + className + ".php' time='0.01'/><testcase name='testAlpha with data set #0' classname='" + className + "' file='tests/" + className + ".php' line='2' time='0.02'><failure message='Summary assertion failed'>Summary failure detail</failure></testcase></testsuite></testsuites>",
        'XML',
        'elif [ "$PHPUNIT_RUNNER_MODE" = "fail" ]; then',
        '  cat > "$report" <<XML',
        "<testsuites><testcase name='$testcaseName' classname='" + className + "' file='tests/" + className + ".php' line='2' time='0.01'><failure message='Assertion failed'>Assertion failed</failure></testcase></testsuites>",
        'XML',
        'elif [ "$PHPUNIT_RUNNER_MODE" = "multi-output" ]; then',
        '  cat > "$report" <<XML',
        "<testsuites><testsuite><testcase name='testFirst' classname='" + className + "' time='0.01'/><testcase name='testSecond' classname='" + className + "' time='0.02'/></testsuite></testsuites>",
        'XML',
        'elif [ "$PHPUNIT_RUNNER_MODE" = "dot-classname" ]; then',
        '  cat > "$report" <<XML',
        "<testsuites><testcase name='$testcaseName' classname='App.Tests." + className + "' time='0.01'/></testsuites>",
        'XML',
        'elif [ "$PHPUNIT_RUNNER_MODE" = "fail-no-location" ]; then',
        '  cat > "$report" <<XML',
        "<testsuites><testcase name='$testcaseName' classname='" + className + "' time='0.01'><failure message='Assertion failed'>Assertion failed</failure></testcase></testsuites>",
        'XML',
        'else',
        '  cat > "$report" <<XML',
        "<testsuites><testcase name='$testcaseName' classname='$testcaseClass' file='$testcaseFile' time='0.01'/>$additionalCase</testsuites>",
        'XML',
        'fi',
        'if [ -n "$coverage" ]; then',
        '  cat > "$coverage" <<XML',
        '<coverage><file name="' + folder.uri.fsPath + '/tests/' + className + '.php"><line num="1" type="stmt" count="3"/><line num="2" type="stmt" count="0"/><metrics statements="2" coveredstatements="1"/></file></coverage>',
        'XML',
        'fi',
        '',
      ].join('\n');
      await fs.writeFile(runner, runnerSource, 'utf8');
      await fs.chmod(runner, 0o755);
      await vscode.workspace.getConfiguration('phpunitRunner', folder).update(
        'phpunitCommand', runner, vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await vscode.workspace.getConfiguration('phpunitRunner', folder).update(
        'environment', { PHPUNIT_RUNNER_MODE: '' }, vscode.ConfigurationTarget.WorkspaceFolder,
      );
    }

    await vscode.commands.executeCommand('phpunitRunner.diagnoseProject');
    assert.ok(diagnosticOutput.some((line) => line.includes('No tests or configured runner commands are executed')));
    assert.ok(diagnosticOutput.some((line) => line.includes('Framework: PHPUnit')));
    assert.ok(diagnosticOutput.some((line) => line.includes('PHPUnit configuration: not found')));
    assert.ok(diagnosticOutput.some((line) => line.includes('fake-phpunit found')));
    assert.equal(await fs.access(path.join(workspaceA.uri.fsPath, 'runner.log')).then(() => true, () => false), false,
      'project diagnostics do not invoke the configured test runner');
    const artisanPath = path.join(workspaceA.uri.fsPath, 'artisan');
    await fs.writeFile(artisanPath, '<?php // Laravel runner fixture\n', 'utf8');
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'phpunitCommand', 'artisan test', vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await vscode.commands.executeCommand('phpunitRunner.diagnoseProject');
    assert.ok(diagnosticOutput.some((line) => line.includes('Runner: configured artisan found')),
      'project diagnostics recognize non-executable PHP runner scripts');
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'phpunitCommand', path.join(workspaceA.uri.fsPath, 'fake-phpunit'), vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await fs.rm(artisanPath);

    await fs.writeFile(path.join(workspaceA.uri.fsPath, 'tests', 'TestWithTest.php'), `<?php
use PHPUnit\\Framework\\Attributes\\TestWith;

class TestWithTest
{
    #[TestWith([1, 2])]
    #[TestWith([2, 3], 'positive pair')]
    #[TestWith([3, 4])]
    public function testWithRows(int $left, int $right): void {}
}
`, 'utf8');

    await fs.writeFile(path.join(workspaceA.uri.fsPath, 'tests', 'TestWithJsonTest.php'), `<?php
use PHPUnit\\Framework\\Attributes\\TestWithJson;

class TestWithJsonTest
{
    #[TestWithJson('[1, "one"]')]
    #[TestWithJson('[2, "two"]', 'json named')]
    public function testJsonRows(int $id, string $label): void {}
}
`, 'utf8');

    await fs.writeFile(path.join(workspaceA.uri.fsPath, 'tests', 'TestDoxTest.php'), `<?php
use PHPUnit\\Framework\\Attributes\\TestDox;

class TestDoxTest
{
    #[TestDox('A readable description')]
    public function testRawMethodName(): void {}
}
`, 'utf8');

    await fs.writeFile(path.join(workspaceA.uri.fsPath, 'tests', 'DataProviderTest.php'), `<?php
class DataProviderTest
{
    /** @dataProvider providePairs */
    public function testPairs(int $left, int $right): void {}

    public static function providePairs(): array
    {
        return [
            'positive pair' => [1, 2],
            [3, 4],
        ];
    }
}
`, 'utf8');

    await fs.writeFile(path.join(workspaceA.uri.fsPath, 'tests', 'DynamicDataProviderTest.php'), `<?php
use PHPUnit\\Framework\\Attributes\\DataProvider;

class DynamicDataProviderTest
{
    #[DataProvider('provideDynamicValues')]
    public function testDynamic(string $value): void {}

    public static function provideDynamicValues(): iterable
    {
        return self::loadValues();
    }

    private static function loadValues(): iterable { return []; }
}
`, 'utf8');

    await api.refresh();
    await until(
      () => flatten(api.controller.items).some((item) => item.label === '"runtime named"'),
      'runtime PHPUnit listing discovers dynamic provider data sets before a test run',
    );
    const runtimeDataset = flatten(api.controller.items).find((item) => item.label === '"runtime named"');
    assert.ok(runtimeDataset && runtimeDataset.parent, 'runtime dataset is attached to its source method');
    const runtimeDatasetEvents = [];
    const restoreRuntimeDatasetCapture = captureRunEvents(api.controller, runtimeDatasetEvents);
    const runtimeRunProfile = api.profiles.find((profile) => profile.kind === vscode.TestRunProfileKind.Run);
    await runtimeRunProfile.runHandler(
      new vscode.TestRunRequest([runtimeDataset]),
      new vscode.CancellationTokenSource().token,
    );
    restoreRuntimeDatasetCapture();
    assert.ok(runtimeDatasetEvents.some((event) => event.id === runtimeDataset.id && event.state === 'passed'),
      'runtime-discovered provider data sets can run independently');
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: '', RUNTIME_DATASET_MODE: 'empty' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await api.refresh();
    await until(
      () => !flatten(api.controller.items).some((item) => item.id === runtimeDataset.id),
      'a successful runtime listing removes provider rows that no longer exist',
    );
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: '', RUNTIME_DATASET_MODE: 'present' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await api.refresh();
    await until(
      () => flatten(api.controller.items).some((item) => item.id === runtimeDataset.id),
      'a refreshed provider listing restores current runtime data sets',
    );

    const findMethod = (name) => flatten(api.controller.items).find((item) => item.label === name);
    assert.ok(findMethod('testAlpha'), 'workspace A test is discovered');
    const alphaBeforeRefresh = findMethod('testAlpha');
    await api.refresh();
    assert.strictEqual(findMethod('testAlpha'), alphaBeforeRefresh,
      'refresh retains unchanged test items instead of rebuilding the whole tree');
    assert.ok(findMethod('testBeta'), 'workspace B test is discovered');
    const testDoxItem = findMethod('A readable description');
    assert.ok(testDoxItem, 'literal TestDox labels are shown for PHPUnit methods');
    const pestParent = findMethod('adds values');
    const pestDataset = findMethod('adds values (with data set #0)');
    assert.ok(pestParent && pestDataset, 'literal Pest data sets appear in the test tree');
    assert.deepEqual([...pestParent.children].map(([, item]) => item.label), [
      'adds values (with data set #0)',
      'adds values (with data set #1)',
    ]);
    const generatorParent = findMethod('generated values');
    const generatorDataset = findMethod('generated values (with data set "first")');
    assert.ok(generatorParent && generatorDataset, 'literal generator yields appear in the test tree');
    assert.deepEqual([...generatorParent.children].map(([, item]) => item.label), [
      'generated values (with data set "first")',
      'generated values (with data set "second")',
    ]);
    const testWithParent = findMethod('testWithRows');
    assert.ok(testWithParent, 'PHPUnit TestWith method is discovered');
    assert.deepEqual(
      [...testWithParent.children].map(([, item]) => item.label),
      ['#0', 'positive pair', '#1'],
      'literal TestWith rows are selectable before running the test',
    );
    const testWithJsonParent = findMethod('testJsonRows');
    assert.ok(testWithJsonParent, 'PHPUnit TestWithJson method is discovered');
    assert.deepEqual(
      [...testWithJsonParent.children].map(([, item]) => item.label),
      ['#0', 'json named'],
      'literal TestWithJson rows are selectable before running the test',
    );
    const dataProviderParent = findMethod('testPairs');
    assert.ok(dataProviderParent, 'PHPUnit DataProvider method is discovered');
    assert.deepEqual(
      [...dataProviderParent.children].map(([, item]) => item.label),
      ['positive pair', '#0'],
      'literal DataProvider rows are selectable before running the test',
    );
    const pestEvents = [];
    const restorePestCapture = captureRunEvents(api.controller, pestEvents);
    const testRunProfile = api.profiles.find((profile) => profile.kind === vscode.TestRunProfileKind.Run);
    const parallelProfile = api.profiles.find((profile) => profile.label === 'Parallel Tests');
    assert.ok(testRunProfile);
    assert.ok(parallelProfile && !parallelProfile.isDefault, 'Parallel Tests is available as an opt-in profile');
    assert.equal(testRunProfile.supportsContinuousRun, true, 'the Run Tests profile exposes VS Code continuous runs');

    const continuousLogPath = path.join(workspaceA.uri.fsPath, 'runner.log');
    const continuousLogCount = async () => (await fs.readFile(continuousLogPath, 'utf8').catch(() => ''))
      .split('\n').filter((line) => line.startsWith('invoked ') && !line.includes('--list-tests-xml')).length;
    const originalRunner = path.join(workspaceA.uri.fsPath, 'fake-phpunit');
    const parallelRunnerPath = path.join(workspaceA.uri.fsPath, 'vendor', 'bin', 'paratest');
    const fakePhpExecutable = path.join(workspaceA.uri.fsPath, 'fake-php');
    await fs.mkdir(path.dirname(parallelRunnerPath), { recursive: true });
    await fs.copyFile(originalRunner, parallelRunnerPath);
    await fs.chmod(parallelRunnerPath, 0o755);
    await fs.writeFile(fakePhpExecutable, '#!/bin/sh\nrunner="$1"\nshift\nexec "$runner" "$@"\n', 'utf8');
    await fs.chmod(fakePhpExecutable, 0o755);
    const workspaceAConfig = vscode.workspace.getConfiguration('phpunitRunner', workspaceA);
    await workspaceAConfig.update('phpunitCommand', 'vendor/bin/phpunit', vscode.ConfigurationTarget.WorkspaceFolder);
    await workspaceAConfig.update('phpExecutable', fakePhpExecutable, vscode.ConfigurationTarget.Workspace);
    await workspaceAConfig.update('parallel.processes', 3, vscode.ConfigurationTarget.WorkspaceFolder);
    const beforeParallelRun = await continuousLogCount();
    const parallelEvents = [];
    const restoreParallelCapture = captureRunEvents(api.controller, parallelEvents);
    await parallelProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')], undefined, parallelProfile),
      new vscode.CancellationTokenSource().token,
    );
    restoreParallelCapture();
    assert.ok(parallelEvents.some((event) => event.label === 'testAlpha' && event.state === 'passed'),
      `ParaTest JUnit results map to the selected test (${JSON.stringify(parallelEvents)})`);
    assert.equal(await continuousLogCount(), beforeParallelRun + 1, 'a selected parallel scope uses one runner invocation');
    const parallelInvocation = (await fs.readFile(continuousLogPath, 'utf8')).split('\n').findLast((line) => line.startsWith('invoked '));
    assert.match(parallelInvocation, /--processes=3/);
    assert.match(parallelInvocation, /--filter/);
    const parallelCancellationEvents = [];
    const restoreParallelCancellationCapture = captureRunEvents(api.controller, parallelCancellationEvents);
    await fs.rm(path.join(workspaceA.uri.fsPath, 'runner-ready'), { force: true });
    await workspaceAConfig.update('environment', { PHPUNIT_RUNNER_MODE: 'hang' }, vscode.ConfigurationTarget.WorkspaceFolder);
    const parallelCancellation = new vscode.CancellationTokenSource();
    const parallelCancellationRun = Promise.resolve(parallelProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')], undefined, parallelProfile),
      parallelCancellation.token,
    ));
    await until(
      () => fs.access(path.join(workspaceA.uri.fsPath, 'runner-ready')).then(() => true, () => false),
      'ParaTest runner starts before cancellation',
    );
    parallelCancellation.cancel();
    await parallelCancellationRun;
    restoreParallelCancellationCapture();
    parallelCancellation.dispose();
    assert.ok(parallelCancellationEvents.some((event) => event.label === 'testAlpha' && event.state === 'skipped'),
      'cancelling a parallel runner marks its selected test skipped');
    await workspaceAConfig.update('phpunitCommand', originalRunner, vscode.ConfigurationTarget.WorkspaceFolder);
    await workspaceAConfig.update('phpExecutable', 'php', vscode.ConfigurationTarget.Workspace);
    await workspaceAConfig.update('environment', { PHPUNIT_RUNNER_MODE: '' }, vscode.ConfigurationTarget.WorkspaceFolder);
    await workspaceAConfig.update('parallel.processes', undefined, vscode.ConfigurationTarget.WorkspaceFolder);

    const initialContinuousLogCount = await continuousLogCount();
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'continuousTesting', true, vscode.ConfigurationTarget.Workspace,
    );
    const continuousCancellation = new vscode.CancellationTokenSource();
    const continuousRun = testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')], undefined, testRunProfile, true),
      continuousCancellation.token,
    );
    await until(async () => await continuousLogCount() > initialContinuousLogCount, 'native continuous testing performs its initial run');
    const alphaDocument = await vscode.workspace.openTextDocument(path.join(workspaceA.uri.fsPath, 'tests', 'AlphaTest.php'));
    const alphaEdit = new vscode.WorkspaceEdit();
    alphaEdit.insert(alphaDocument.uri, alphaDocument.positionAt(alphaDocument.getText().length), '\n// continuous run fixture\n');
    await vscode.workspace.applyEdit(alphaEdit);
    await alphaDocument.save();
    await until(async () => await continuousLogCount() > initialContinuousLogCount + 1, 'saving a selected PHP test repeats a native continuous run');
    await delay(400);
    assert.equal(await continuousLogCount(), initialContinuousLogCount + 2,
      'native and save-triggered continuous testing do not duplicate the same save run');
    continuousCancellation.cancel();
    await continuousRun;
    continuousCancellation.dispose();
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'continuousTesting', false, vscode.ConfigurationTarget.Workspace,
    );

    const alphaFileItem = findMethod('AlphaTest.php');
    assert.ok(alphaFileItem, 'the Alpha test file is selectable for exclusion checks');
    const beforeExcludedRun = await continuousLogCount();
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([alphaFileItem], [findMethod('testAlpha')]),
      new vscode.CancellationTokenSource().token,
    );
    assert.equal(await continuousLogCount(), beforeExcludedRun, 'excluding every test in a selected file prevents runner execution');

    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'command', '${phpunit} ${phpunitargs}', vscode.ConfigurationTarget.Workspace,
    );
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'remote.reportTransferCommand', 'scp ${remoteJunitReport} ${localJunitReport} ${invalid}', vscode.ConfigurationTarget.WorkspaceFolder,
    );
    const invalidTransferEvents = [];
    const invalidTransferOutputs = [];
    const restoreInvalidTransferCapture = captureRunEvents(api.controller, invalidTransferEvents, [], invalidTransferOutputs);
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')]),
      new vscode.CancellationTokenSource().token,
    );
    restoreInvalidTransferCapture();
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'command', '', vscode.ConfigurationTarget.Workspace,
    );
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'remote.reportTransferCommand', '', vscode.ConfigurationTarget.WorkspaceFolder,
    );
    assert.ok(invalidTransferEvents.some((event) => event.label === 'testAlpha' && event.state === 'passed'),
      'an invalid report-transfer setting does not discard a readable JUnit result');
    assert.ok(invalidTransferOutputs.some((output) => output.includes('Remote report transfer configuration is invalid')),
      'invalid report-transfer configuration is reported to the user');

    const testDoxLog = path.join(workspaceA.uri.fsPath, 'runner.log');
    await fs.writeFile(testDoxLog, '', 'utf8');
    const testDoxEvents = [];
    const restoreTestDoxCapture = captureRunEvents(api.controller, testDoxEvents);
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([testDoxItem]),
      new vscode.CancellationTokenSource().token,
    );
    restoreTestDoxCapture();
    const testDoxInvocation = await fs.readFile(testDoxLog, 'utf8');
    assert.ok(testDoxInvocation.includes('--filter ~^TestDoxTest::testRawMethodName(?: with data set .*)?$~i'), testDoxInvocation);
    assert.ok(
      testDoxEvents.some((event) => event.id === testDoxItem.id && event.state === 'passed'),
      `the TestDox label still runs and maps to its method: ${JSON.stringify(testDoxEvents)}`,
    );

    const dataProviderDataset = [...dataProviderParent.children].map(([, item]) => item).find((item) => item.label === 'positive pair');
    assert.ok(dataProviderDataset);
    const dataProviderLog = path.join(workspaceA.uri.fsPath, 'runner.log');
    await fs.writeFile(dataProviderLog, '', 'utf8');
    const dataProviderEvents = [];
    const restoreDataProviderCapture = captureRunEvents(api.controller, dataProviderEvents);
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([dataProviderDataset]),
      new vscode.CancellationTokenSource().token,
    );
    restoreDataProviderCapture();
    const dataProviderInvocation = await fs.readFile(dataProviderLog, 'utf8');
    assert.ok(dataProviderInvocation.includes('--filter ~^DataProviderTest::testPairs with data set "positive pair"$~i'), dataProviderInvocation);
    assert.ok(
      dataProviderEvents.some((event) => event.id === dataProviderDataset.id && event.state === 'passed'),
      `the selected provider row is run and mapped: ${JSON.stringify(dataProviderEvents)}`,
    );

    const outputFormatConfig = vscode.workspace.getConfiguration('phpunitRunner', workspaceA);
    const previousOutputFormat = outputFormatConfig.get('output.format', {});
    await outputFormatConfig.update('output.format', {
      colors: false,
      duration: false,
      testCase: 'RESULT: {status} {name}',
    }, vscode.ConfigurationTarget.WorkspaceFolder);
    const customOutput = [];
    const restoreOutputCapture = captureRunEvents(api.controller, [], [], customOutput);
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')]),
      new vscode.CancellationTokenSource().token,
    );
    restoreOutputCapture();
    await outputFormatConfig.update('output.format', previousOutputFormat, vscode.ConfigurationTarget.WorkspaceFolder);
    assert.match(customOutput.join(''), /RESULT: PASS testAlpha/);
    assert.doesNotMatch(customOutput.join(''), /\u001b\[/, 'custom plain output contains no ANSI colors');

    const dottedClassnameEvents = [];
    const restoreDottedClassnameCapture = captureRunEvents(api.controller, dottedClassnameEvents);
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: 'dot-classname' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')]),
      new vscode.CancellationTokenSource().token,
    );
    restoreDottedClassnameCapture();
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: '' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    assert.equal(
      dottedClassnameEvents.some((event) => event.id === findMethod('testAlpha').id && event.state === 'passed'),
      true,
      `a PHPUnit JUnit classname using dots maps to the selected PHP namespace and method: ${JSON.stringify(dottedClassnameEvents)}`,
    );

    const multiCaseOutput = [];
    const restoreMultiOutputCapture = captureRunEvents(api.controller, [], [], multiCaseOutput);
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: 'multi-output' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')]),
      new vscode.CancellationTokenSource().token,
    );
    restoreMultiOutputCapture();
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: '' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    assert.equal(multiCaseOutput.length, 1, 'multi-case output is appended as one block to keep the Test Results layout aligned');
    assert.match(multiCaseOutput[0], /testFirst/);
    assert.match(multiCaseOutput[0], /testSecond/);

    const testWithDataset = [...testWithParent.children].map(([, item]) => item).find((item) => item.label === 'positive pair');
    assert.ok(testWithDataset);
    const testWithLog = path.join(workspaceA.uri.fsPath, 'runner.log');
    await fs.writeFile(testWithLog, '', 'utf8');
    const testWithEvents = [];
    const restoreTestWithCapture = captureRunEvents(api.controller, testWithEvents);
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: 'test-with' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([testWithDataset]),
      new vscode.CancellationTokenSource().token,
    );
    restoreTestWithCapture();
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: '' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    const testWithInvocation = await fs.readFile(testWithLog, 'utf8');
    assert.ok(testWithInvocation.includes('--filter ~^TestWithTest::testWithRows with data set "positive pair"$~i'), testWithInvocation);
    assert.ok(
      testWithEvents.some((event) => event.id === testWithDataset.id && event.state === 'passed'),
      `the selected TestWith row receives its PHPUnit result: ${JSON.stringify(testWithEvents)}`,
    );

    const testWithJsonDataset = [...testWithJsonParent.children].map(([, item]) => item).find((item) => item.label === 'json named');
    assert.ok(testWithJsonDataset);
    const testWithJsonLog = path.join(workspaceA.uri.fsPath, 'runner.log');
    await fs.writeFile(testWithJsonLog, '', 'utf8');
    const testWithJsonEvents = [];
    const restoreTestWithJsonCapture = captureRunEvents(api.controller, testWithJsonEvents);
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: 'test-with' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([testWithJsonDataset]),
      new vscode.CancellationTokenSource().token,
    );
    restoreTestWithJsonCapture();
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: '' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    const testWithJsonInvocation = await fs.readFile(testWithJsonLog, 'utf8');
    assert.ok(testWithJsonInvocation.includes('--filter ~^TestWithJsonTest::testJsonRows with data set "json named"$~i'), testWithJsonInvocation);
    assert.ok(
      testWithJsonEvents.some((event) => event.id === testWithJsonDataset.id && event.state === 'passed'),
      `the selected TestWithJson row receives its PHPUnit result: ${JSON.stringify(testWithJsonEvents)}`,
    );

    const outputPresetConfig = vscode.workspace.getConfiguration('phpunitRunner', workspaceA);
    const previousOutputPreset = outputPresetConfig.get('output.preset', 'collision');
    const previousSummaryFormat = outputPresetConfig.get('output.format', {});
    await outputPresetConfig.update('output.preset', 'summary', vscode.ConfigurationTarget.Workspace);
    await outputPresetConfig.update('output.format', {
      ...previousSummaryFormat,
      colors: false,
      duration: false,
    }, vscode.ConfigurationTarget.WorkspaceFolder);
    const summaryOutput = [];
    const restoreSummaryOutputCapture = captureRunEvents(api.controller, [], [], summaryOutput);
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: 'summary' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')]),
      new vscode.CancellationTokenSource().token,
    );
    restoreSummaryOutputCapture();
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: '' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await outputPresetConfig.update('output.preset', previousOutputPreset, vscode.ConfigurationTarget.Workspace);
    await outputPresetConfig.update('output.format', previousSummaryFormat, vscode.ConfigurationTarget.WorkspaceFolder);
    const summaryText = summaryOutput.join('');
    assert.match(summaryText, /2 tests: 1 passed, 1 failed, 0 errors, 0 skipped/);
    assert.match(summaryText, /testAlpha with data set #0/);
    assert.match(summaryText, /Summary failure detail/);
    assert.doesNotMatch(summaryText, /PASS testAlpha(?:\r?\n|$)/, 'summary omits passed-case detail lines');

    const failureOutputEvents = [];
    const restoreFailureOutputCapture = captureRunEvents(api.controller, [], [], [], failureOutputEvents);
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: 'fail' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')]),
      new vscode.CancellationTokenSource().token,
    );
    restoreFailureOutputCapture();
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: '' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    const linkedFailureOutput = failureOutputEvents.find((event) => event.output.includes('tests/AlphaTest.php:2'));
    assert.ok(linkedFailureOutput, 'structured failure output contains its source location');
    assert.equal(linkedFailureOutput.location.uri.fsPath, path.join(workspaceA.uri.fsPath, 'tests', 'AlphaTest.php'));
    assert.equal(linkedFailureOutput.location.range.start.line, 1, 'failure output links to the one-based JUnit line converted to a VS Code line');

    const missingLocationEvents = [];
    const restoreMissingLocationCapture = captureRunEvents(api.controller, [], [], [], missingLocationEvents);
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: 'fail-no-location' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')]),
      new vscode.CancellationTokenSource().token,
    );
    restoreMissingLocationCapture();
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: '' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    const unlocatedFailureOutput = missingLocationEvents.find((event) => event.output.includes('Assertion failed'));
    assert.ok(unlocatedFailureOutput, 'failure text remains visible when its report has no source location');
    assert.equal(unlocatedFailureOutput.location, undefined, 'no editor location is attached when the report has no file and line');

    const initialClears = outputClears.length;
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([generatorDataset]),
      new vscode.CancellationTokenSource().token,
    );
    restorePestCapture();
    assert.ok(pestEvents.some((event) => event.id === generatorDataset.id && event.state === 'passed'), 'a Pest generator data set can run independently');
    assert.equal(outputClears.length, initialClears + 1, 'output is cleared once by default for a run');

    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'clearOutputOnRun', false, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    const disabledClears = outputClears.length;
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha')]),
      new vscode.CancellationTokenSource().token,
    );
    assert.equal(outputClears.length, disabledClears, 'a workspace can preserve earlier output');

    const workspaceATestsFolder = flatten(api.controller.items).find((item) => (
      item.label === 'tests'
      && [...item.children].some(([, child]) => child.uri?.fsPath.startsWith(workspaceA.uri.fsPath))
    ));
    assert.ok(workspaceATestsFolder, 'workspace A test folder is available');
    const disabledFolderClears = outputClears.length;
    const folderRunEvents = [];
    const restoreFolderRunCapture = captureRunEvents(api.controller, folderRunEvents);
    await fs.rm(path.join(workspaceA.uri.fsPath, 'runner.log'), { force: true });
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([workspaceATestsFolder]),
      new vscode.CancellationTokenSource().token,
    );
    restoreFolderRunCapture();
    assert.equal(outputClears.length, disabledFolderClears, 'folder selections use descendant workspace settings');
    assert.equal(folderRunEvents.filter((event) => event.state === 'started').length, 1, 'large scopes start their parent while PHPUnit runs instead of sending a start update for every test');
    const folderInvocations = (await fs.readFile(path.join(workspaceA.uri.fsPath, 'runner.log'), 'utf8')).trim().split('\n');
    assert.equal(folderInvocations.length, 1, 'a folder scope starts PHPUnit once');
    assert.match(folderInvocations[0], /AlphaTest\.php/, 'the folder invocation includes the first selected PHP test file');
    assert.match(folderInvocations[0], /ValuesTest\.php/, 'the folder invocation includes the second selected PHP test file');

    await fs.rm(path.join(workspaceA.uri.fsPath, 'runner.log'), { force: true });
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('AlphaTest.php'), findMethod('ValuesTest.php')]),
      new vscode.CancellationTokenSource().token,
    );
    const multiFileInvocations = (await fs.readFile(path.join(workspaceA.uri.fsPath, 'runner.log'), 'utf8')).trim().split('\n');
    assert.equal(multiFileInvocations.length, 1, 'multiple selected files in one workspace start PHPUnit once');
    assert.match(multiFileInvocations[0], /AlphaTest\.php/);
    assert.match(multiFileInvocations[0], /ValuesTest\.php/);

    const mixedMultiRootClears = outputClears.length;
    await testRunProfile.runHandler(
      new vscode.TestRunRequest([findMethod('testAlpha'), findMethod('testBeta')]),
      new vscode.CancellationTokenSource().token,
    );
    assert.equal(outputClears.length, mixedMultiRootClears + 1, 'a multi-root run clears once when any included workspace enables it');

    const dynamicTestPath = path.join(workspaceA.uri.fsPath, 'tests', 'WatcherTest.php');
    await fs.writeFile(dynamicTestPath, '<?php class WatcherTest { public function testCreated(): void {} }', 'utf8');
    await until(() => flatten(api.controller.items).some((item) => item.label === 'WatcherTest.php'), 'create watcher discovers new PHP tests');
    await fs.rm(dynamicTestPath);
    await until(() => !flatten(api.controller.items).some((item) => item.label === 'WatcherTest.php'), 'delete watcher removes PHP tests');

    const composerLockPath = path.join(workspaceA.uri.fsPath, 'composer.lock');
    const countRuntimeListings = async () => {
      const log = await fs.readFile(path.join(workspaceA.uri.fsPath, 'runner.log'), 'utf8').catch(() => '');
      return log.split('\n').filter((line) => line.includes('--list-tests-xml')).length;
    };
    let runtimeListingCount = await countRuntimeListings();
    await fs.writeFile(composerLockPath, '{"packages": []}\n');
    await until(async () => await countRuntimeListings() > runtimeListingCount, 'creating composer.lock refreshes runtime test discovery');
    runtimeListingCount = await countRuntimeListings();
    await fs.writeFile(composerLockPath, '{"packages": [], "content-hash": "updated"}\n');
    await until(async () => await countRuntimeListings() > runtimeListingCount, 'changing composer.lock refreshes runtime test discovery');
    runtimeListingCount = await countRuntimeListings();
    await fs.rm(composerLockPath);
    await until(async () => await countRuntimeListings() > runtimeListingCount, 'deleting composer.lock refreshes runtime test discovery');

    const composerManifestPath = path.join(workspaceA.uri.fsPath, 'composer.json');
    runtimeListingCount = await countRuntimeListings();
    await fs.writeFile(composerManifestPath, '{"require-dev": {"phpunit/phpunit": "^11.0"}}\n');
    await until(async () => await countRuntimeListings() > runtimeListingCount, 'creating composer.json refreshes runtime test discovery');
    runtimeListingCount = await countRuntimeListings();
    await fs.writeFile(composerManifestPath, '{"require-dev": {"pestphp/pest": "^3.0"}}\n');
    await until(async () => await countRuntimeListings() > runtimeListingCount, 'changing composer.json refreshes runtime test discovery');
    runtimeListingCount = await countRuntimeListings();
    await fs.rm(composerManifestPath);
    await until(async () => await countRuntimeListings() > runtimeListingCount, 'deleting composer.json refreshes runtime test discovery');

    const savedTestPath = path.join(workspaceB.uri.fsPath, 'tests', 'SavedTest.php');
    await fs.writeFile(savedTestPath, '<?php class SavedTest {}', 'utf8');
    const savedDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(savedTestPath));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(savedDocument.uri, new vscode.Range(savedDocument.positionAt(0), savedDocument.positionAt(savedDocument.getText().length)),
      '<?php class SavedTest { public function testAfterSave(): void {} }');
    await vscode.workspace.applyEdit(edit);
    await savedDocument.save();
    await until(() => flatten(api.controller.items).some((item) => item.label === 'testAfterSave'), 'save event refreshes tests from the document contents');

    const groupEvents = [];
    const restoreGroupCapture = captureRunEvents(api.controller, groupEvents);
    const groupClears = outputClears.length;
    await api.runGroup('integration');
    restoreGroupCapture();
    assert.equal(outputClears.length, groupClears + 1, 'a group run clears once across its workspaces');
    assert.ok((await fs.readFile(path.join(workspaceA.uri.fsPath, 'runner.log'), 'utf8')).includes('invoked'));
    assert.ok((await fs.readFile(path.join(workspaceB.uri.fsPath, 'runner.log'), 'utf8')).includes('invoked'));
    assert.equal(groupEvents.filter((event) => event.state === 'passed').length, 2, 'each workspace group reports its test passed');

    await vscode.workspace.getConfiguration('phpunitRunner', workspaceB).update(
      'clearOutputOnRun', false, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    const disabledGroupClears = outputClears.length;
    await api.runGroup('integration');
    assert.equal(outputClears.length, disabledGroupClears, 'group output stays intact when every included workspace disables clearing');

    const cancelItem = findMethod('testAlpha');
    const coverageProfile = api.profiles.find((profile) => profile.kind === vscode.TestRunProfileKind.Coverage);
    assert.ok(cancelItem && coverageProfile);
    const coverages = [];
    const restoreCoverageCapture = captureRunEvents(api.controller, [], coverages);
    const coverageRequest = new vscode.TestRunRequest([cancelItem], undefined, coverageProfile);
    await Promise.resolve(coverageProfile.runHandler(coverageRequest, new vscode.CancellationTokenSource().token));
    restoreCoverageCapture();
    assert.equal(coverages.length, 1, 'the extension reports Clover coverage to VS Code');
    assert.equal(coverages[0].uri.fsPath, path.join(workspaceA.uri.fsPath, 'tests', 'AlphaTest.php'));
    const details = await coverageProfile.loadDetailedCoverage(
      undefined,
      coverages[0],
      new vscode.CancellationTokenSource().token,
    );
    assert.deepEqual(details.map((item) => item.executed), [3, 0]);
    assert.deepEqual(details.map((item) => item.location.line), [0, 1]);

    assert.ok(cancelItem && testRunProfile);
    const events = [];
    const restoreCancellationCapture = captureRunEvents(api.controller, events);
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: 'hang' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    const cancellation = new vscode.CancellationTokenSource();
    const request = new vscode.TestRunRequest([cancelItem], undefined, testRunProfile);
    const running = Promise.resolve(testRunProfile.runHandler(request, cancellation.token));
    await until(
      () => fs.access(path.join(workspaceA.uri.fsPath, 'runner-ready')).then(() => true, () => false),
      'fake runner starts before cancellation',
    );
    cancellation.cancel();
    await running;
    restoreCancellationCapture();
    cancellation.dispose();
    assert.ok(events.some((event) => event.id === cancelItem.id && event.state === 'skipped'), 'cancelled tests are skipped rather than failed');
    assert.ok(!events.some((event) => event.id === cancelItem.id && event.state === 'failed'), 'cancellation does not report a test failure');

    await vscode.commands.executeCommand('phpunitRunner.showTestInsights');
    assert.ok(diagnosticOutput.includes('Slowest tests:'), 'test insights show persisted durations from reported runs');
    assert.ok(diagnosticOutput.includes('Flaky candidates (pass and fail in the latest 10 outcomes):'));
    await vscode.commands.executeCommand('phpunitRunner.clearTestInsights');
    diagnosticOutput.length = 0;
    await vscode.commands.executeCommand('phpunitRunner.showTestInsights');
    assert.ok(
      diagnosticOutput.includes('No completed, reported test runs are available yet.'),
      'clearing insights removes recent history across the active workspace folders',
    );

    console.log('VS Code extension-host tests passed');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
