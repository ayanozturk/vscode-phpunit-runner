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

function captureRunEvents(controller, events, coverages = []) {
  const original = controller.createTestRun;
  controller.createTestRun = function (...args) {
    const run = original.apply(controller, args);
    return new Proxy(run, {
      get(target, property) {
        const method = Reflect.get(target, property, target);
        if (['passed', 'failed', 'skipped', 'errored'].includes(property)) {
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
    const api = await extension.activate();
    assert.ok(api && api.controller, 'test-mode activation exposes the controller');

    const commands = new Set(await vscode.commands.getCommands(true));
    assert.ok(commands.has('phpunitRunner.refreshTests'));
    assert.ok(commands.has('phpunitRunner.runByGroup'));

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
        'echo invoked >> "' + runLog + '"',
        'report=""',
        'coverage=""',
        'previous=""',
        'for argument in "$@"; do',
        '  if [ "$previous" = "report" ]; then report="$argument"; previous=""; continue; fi',
        '  if [ "$previous" = "coverage" ]; then coverage="$argument"; previous=""; continue; fi',
        '  if [ "$argument" = "--log-junit" ]; then previous="report"; fi',
        '  if [ "$argument" = "--coverage-clover" ]; then previous="coverage"; fi',
        'done',
        'cat > "$report" <<XML',
        '<testsuites><testcase name="' + methodName + '" classname="' + className + '" time="0.01"/></testsuites>',
        'XML',
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

    await api.refresh();
    const findMethod = (name) => flatten(api.controller.items).find((item) => item.label === name);
    assert.ok(findMethod('testAlpha'), 'workspace A test is discovered');
    assert.ok(findMethod('testBeta'), 'workspace B test is discovered');

    const dynamicTestPath = path.join(workspaceA.uri.fsPath, 'tests', 'WatcherTest.php');
    await fs.writeFile(dynamicTestPath, '<?php class WatcherTest { public function testCreated(): void {} }', 'utf8');
    await until(() => flatten(api.controller.items).some((item) => item.label === 'WatcherTest.php'), 'create watcher discovers new PHP tests');
    await fs.rm(dynamicTestPath);
    await until(() => !flatten(api.controller.items).some((item) => item.label === 'WatcherTest.php'), 'delete watcher removes PHP tests');

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
    await api.runGroup('integration');
    restoreGroupCapture();
    assert.ok((await fs.readFile(path.join(workspaceA.uri.fsPath, 'runner.log'), 'utf8')).includes('invoked'));
    assert.ok((await fs.readFile(path.join(workspaceB.uri.fsPath, 'runner.log'), 'utf8')).includes('invoked'));
    assert.equal(groupEvents.filter((event) => event.state === 'passed').length, 2, 'each workspace group reports its test passed');

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

    const runProfile = api.profiles.find((profile) => profile.kind === vscode.TestRunProfileKind.Run);
    assert.ok(cancelItem && runProfile);
    const events = [];
    const restoreCancellationCapture = captureRunEvents(api.controller, events);
    await vscode.workspace.getConfiguration('phpunitRunner', workspaceA).update(
      'environment', { PHPUNIT_RUNNER_MODE: 'hang' }, vscode.ConfigurationTarget.WorkspaceFolder,
    );
    const cancellation = new vscode.CancellationTokenSource();
    const request = new vscode.TestRunRequest([cancelItem], undefined, runProfile);
    const running = Promise.resolve(runProfile.runHandler(request, cancellation.token));
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

    console.log('VS Code extension-host tests passed');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
