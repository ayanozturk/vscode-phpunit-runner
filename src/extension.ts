import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { autoDetectConfigurationFile, resolveInvocation } from './invoke';
import {
  aggregateMethodStatus,
  firstFailureLocation,
  firstFailureMessage,
  parseJUnitXml,
} from './junit';
import { classNamesMatch, methodNameFromTestCase, parseTestSource } from './parser';
import { DEFAULT_EXCLUDE_GLOBS, DEFAULT_TEST_GLOBS } from './paths';
import type { JUnitTestCase, RunnerConfig, SourceRange, TestTarget } from './types';

type TestItemData = TestTarget & { uri: vscode.Uri };

const itemData = new WeakMap<vscode.TestItem, TestItemData>();

let outputChannel: vscode.OutputChannel;
let controller: vscode.TestController;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('PHPUnit Runner');
  controller = vscode.tests.createTestController('phpunitRunner', 'PHPUnit Runner');

  context.subscriptions.push(outputChannel, controller);

  controller.resolveHandler = async (item) => {
    if (item) {
      await refreshTestItem(item);
      return;
    }

    await discoverWorkspaceTests();
  };

  context.subscriptions.push(
    controller.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runTests, true),
    vscode.commands.registerCommand('phpunitRunner.refreshTests', async () => {
      await discoverWorkspaceTests();
    }),
    vscode.commands.registerCommand('phpunitRunner.runCurrentFile', async () => {
      await runCurrentFile();
    }),
    vscode.commands.registerCommand('phpunitRunner.runTestAtCursor', async () => {
      await runTestAtCursor();
    }),
    vscode.commands.registerCommand('phpunitRunner.showOutput', () => {
      outputChannel.show();
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.languageId !== 'php') {
        return;
      }

      await refreshUri(document.uri, document.getText());
    }),
    vscode.workspace.onDidDeleteFiles(async (event) => {
      for (const uri of event.files) {
        removeFileItem(uri);
      }
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.php');
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/phpunit.xml*');
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(async (uri) => {
      await refreshUri(uri);
    }),
    watcher.onDidChange(async (uri) => {
      await refreshUri(uri);
    }),
    watcher.onDidDelete((uri) => {
      removeFileItem(uri);
    }),
    configWatcher,
    configWatcher.onDidCreate(async () => {
      await discoverWorkspaceTests();
    }),
    configWatcher.onDidChange(async () => {
      await discoverWorkspaceTests();
    }),
    configWatcher.onDidDelete(async () => {
      await discoverWorkspaceTests();
    }),
  );

  await discoverWorkspaceTests();
}

export function deactivate(): void {
  outputChannel?.dispose();
}

async function discoverWorkspaceTests(): Promise<void> {
  const uris = await findCandidateTestFiles();
  controller.items.replace([]);
  await Promise.all(uris.map((uri) => refreshUri(uri)));
}

async function findCandidateTestFiles(): Promise<vscode.Uri[]> {
  const config = getConfig();
  const globs = config.get<string[]>('testFileGlobs', DEFAULT_TEST_GLOBS);
  const excludes = config.get<string[]>('excludeGlobs', DEFAULT_EXCLUDE_GLOBS);
  const excludeGlob = excludes.length > 0 ? `{${excludes.join(',')}}` : undefined;
  const unique = new Map<string, vscode.Uri>();

  for (const pattern of globs) {
    const files = await vscode.workspace.findFiles(pattern, excludeGlob);
    for (const file of files) {
      unique.set(file.toString(), file);
    }
  }

  return [...unique.values()];
}

async function refreshTestItem(item: vscode.TestItem): Promise<void> {
  const data = itemData.get(item);
  if (!data) {
    return;
  }

  await refreshUri(data.uri);
}

async function refreshUri(uri: vscode.Uri, text?: string): Promise<void> {
  if (path.extname(uri.fsPath).toLowerCase() !== '.php') {
    return;
  }

  const parsed = await parseTestFile(uri, text);
  if (!parsed || parsed.classes.length === 0) {
    removeFileItem(uri);
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const label = path.basename(uri.fsPath);

  const fileItem = controller.createTestItem(uri.toString(), label, uri);
  itemData.set(fileItem, { kind: 'file', uri, filePath: uri.fsPath });

  for (const cls of parsed.classes) {
    const classId = `${uri.toString()}::${cls.fullyQualifiedName}`;
    const classItem = controller.createTestItem(classId, cls.name, uri);
    classItem.range = toVscodeRange(cls.range);
    itemData.set(classItem, {
      kind: 'class',
      uri,
      filePath: uri.fsPath,
      className: cls.fullyQualifiedName,
    });

    for (const method of cls.methods) {
      const methodId = `${classId}::${method.name}`;
      const methodItem = controller.createTestItem(methodId, method.name, uri);
      methodItem.range = toVscodeRange(method.range);
      itemData.set(methodItem, {
        kind: 'method',
        uri,
        filePath: uri.fsPath,
        className: cls.fullyQualifiedName,
        methodName: method.name,
      });
      classItem.children.add(methodItem);
    }

    fileItem.children.add(classItem);
  }

  addFileItemToHierarchy(fileItem, workspaceFolder);
}

async function parseTestFile(uri: vscode.Uri, text?: string) {
  const source = text ?? await readFileText(uri);
  if (source === undefined) {
    return undefined;
  }

  return parseTestSource(uri.fsPath, source);
}

async function readFileText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return await fs.readFile(uri.fsPath, 'utf8');
  } catch (error) {
    outputChannel.appendLine(`[phpunit-runner] Failed to read ${uri.fsPath}: ${String(error)}`);
    return undefined;
  }
}

async function runCurrentFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'php') {
    void vscode.window.showErrorMessage('Open a PHP test file first.');
    return;
  }

  await refreshUri(editor.document.uri, editor.document.getText());
  const item = findFileItem(editor.document.uri);
  if (!item) {
    void vscode.window.showErrorMessage('No PHPUnit tests were found in the current file.');
    return;
  }

  await runTests(new vscode.TestRunRequest([item]), new vscode.CancellationTokenSource().token);
}

async function runTestAtCursor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'php') {
    void vscode.window.showErrorMessage('Open a PHP test file first.');
    return;
  }

  await refreshUri(editor.document.uri, editor.document.getText());
  const fileItem = findFileItem(editor.document.uri);
  if (!fileItem) {
    void vscode.window.showErrorMessage('No PHPUnit tests were found in the current file.');
    return;
  }

  const target = findNarrowestTestItem(fileItem, editor.selection.active);
  if (!target) {
    void vscode.window.showErrorMessage('No PHPUnit test was found at the current cursor position.');
    return;
  }

  await runTests(new vscode.TestRunRequest([target]), new vscode.CancellationTokenSource().token);
}

function findNarrowestTestItem(item: vscode.TestItem, position: vscode.Position): vscode.TestItem | undefined {
  for (const child of collectTestItems(item.children)) {
    if (child.range?.contains(position)) {
      const nested = findNarrowestTestItem(child, position);
      return nested ?? child;
    }
  }

  return item.range?.contains(position) ? item : undefined;
}

async function runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
  const run = controller.createTestRun(request);
  const queue = request.include?.length ? [...request.include] : collectTestItems(controller.items);

  try {
    for (const item of queue) {
      if (token.isCancellationRequested) {
        break;
      }

      await runItem(item, run, token);
    }
  } finally {
    run.end();
  }
}

async function runItem(item: vscode.TestItem, run: vscode.TestRun, token: vscode.CancellationToken): Promise<void> {
  const data = itemData.get(item);
  if (!data && item.children.size > 0) {
    for (const child of collectTestItems(item.children)) {
      await runItem(child, run, token);
    }
    return;
  }

  if (!data) {
    return;
  }

  const targets = collectExecutableItems(item);
  for (const target of targets) {
    run.enqueued(target);
    run.started(target);
  }

  try {
    const result = await executePhpUnit(data, token);
    run.appendOutput(result.output);
    applyExecutionResult(run, item, result);
  } catch (error) {
    const message = new vscode.TestMessage(String(error));
    run.failed(item, message);
    markDescendants(run, item, 'skipped');
  }
}

function applyExecutionResult(
  run: vscode.TestRun,
  item: vscode.TestItem,
  result: { output: string; exitCode: number; duration: number; cases: JUnitTestCase[] },
): void {
  const methods = collectMethodItems(item);
  if (result.cases.length === 0 || methods.length === 0) {
    const message = new vscode.TestMessage(result.output || 'PHPUnit completed without output.');
    if (result.exitCode === 0) {
      run.passed(item, result.duration);
      markDescendants(run, item, 'passed', result.duration);
      return;
    }

    run.failed(item, message, result.duration);
    markDescendants(run, item, 'skipped');
    return;
  }

  let anyFailed = false;

  for (const methodItem of methods) {
    const data = itemData.get(methodItem);
    if (!data?.className || !data.methodName) {
      continue;
    }

    const cases = findCasesForMethod(result.cases, data.className, data.methodName);
    if (!cases || cases.length === 0) {
      run.skipped(methodItem);
      continue;
    }

    const status = aggregateMethodStatus(cases);
    const duration = Math.round(cases.reduce((sum, testCase) => sum + testCase.timeSeconds, 0) * 1000);
    if (status === 'passed') {
      run.passed(methodItem, duration);
      continue;
    }

    if (status === 'skipped') {
      run.skipped(methodItem);
      continue;
    }

    anyFailed = true;
    run.failed(methodItem, createFailureMessage(methodItem, cases), duration);
  }

  const data = itemData.get(item);
  if (data?.kind === 'method') {
    return;
  }

  if (anyFailed || result.exitCode !== 0) {
    run.failed(item, new vscode.TestMessage(result.output || 'One or more PHPUnit tests failed.'), result.duration);
    return;
  }

  run.passed(item, result.duration);
}

function findCasesForMethod(cases: JUnitTestCase[], className: string, methodName: string): JUnitTestCase[] {
  return cases.filter((item) => (
    classNamesMatch(item.className, className)
    && methodNameFromTestCase(item.name) === methodName
  ));
}

function createFailureMessage(item: vscode.TestItem, cases: JUnitTestCase[]): vscode.TestMessage {
  const message = new vscode.TestMessage(firstFailureMessage(cases) || 'PHPUnit test failed.');
  const location = firstFailureLocation(cases);
  const line = location.line && location.line > 0 ? location.line - 1 : item.range?.start.line;
  const uri = location.file ? vscode.Uri.file(location.file) : item.uri;
  if (uri && line !== undefined) {
    message.location = new vscode.Location(uri, new vscode.Position(line, 0));
  }
  return message;
}

function markDescendants(
  run: vscode.TestRun,
  item: vscode.TestItem,
  state: 'passed' | 'skipped',
  duration?: number,
): void {
  if (item.children.size === 0) {
    return;
  }

  for (const child of collectTestItems(item.children)) {
    if (state === 'passed') {
      run.passed(child, duration);
    } else {
      run.skipped(child);
    }

    markDescendants(run, child, state, duration);
  }
}

async function executePhpUnit(
  data: TestItemData,
  token: vscode.CancellationToken,
): Promise<{ output: string; exitCode: number; duration: number; cases: JUnitTestCase[] }> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(data.uri);
  if (!workspaceFolder) {
    throw new Error(`No workspace folder found for ${data.uri.fsPath}`);
  }

  const runnerDir = path.join(workspaceFolder.uri.fsPath, '.phpunit-runner');
  await fs.mkdir(runnerDir, { recursive: true });
  const junitLogPath = path.join(runnerDir, `junit-${Date.now()}-${Math.random().toString(16).slice(2)}.xml`);

  const config = readRunnerConfig(workspaceFolder);
  const invocation = await resolveInvocation({
    workspacePath: workspaceFolder.uri.fsPath,
    target: data,
    config,
    junitLogPath,
    detectedConfigurationFile: config.configurationFile
      ? undefined
      : await autoDetectConfigurationFile(workspaceFolder.uri.fsPath),
  });
  const start = Date.now();

  outputChannel.appendLine(`[phpunit-runner] ${[invocation.command, ...invocation.args].join(' ')}`);

  try {
    const result = await new Promise<{ output: string; exitCode: number }>((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: invocation.cwd,
        env: process.env,
      });

      let output = '';
      const append = (chunk: string | Buffer) => {
        const text = chunk.toString();
        output += text;
        outputChannel.append(text);
      };

      child.stdout.on('data', append);
      child.stderr.on('data', append);

      const subscription = token.onCancellationRequested(() => {
        child.kill();
      });

      child.on('error', (error) => {
        subscription.dispose();
        reject(error);
      });

      child.on('close', (exitCode) => {
        subscription.dispose();
        resolve({
          output,
          exitCode: exitCode ?? 1,
        });
      });
    });

    const cases = await readJUnitCases(junitLogPath);
    return {
      ...result,
      duration: Date.now() - start,
      cases,
    };
  } finally {
    await fs.rm(junitLogPath, { force: true }).catch(() => undefined);
  }
}

async function readJUnitCases(junitLogPath: string): Promise<JUnitTestCase[]> {
  try {
    const xml = await fs.readFile(junitLogPath, 'utf8');
    return parseJUnitXml(xml);
  } catch {
    return [];
  }
}

function readRunnerConfig(scope?: vscode.ConfigurationScope): RunnerConfig {
  const config = getConfig(scope);
  return {
    phpExecutable: config.get<string>('phpExecutable', 'php'),
    phpunitCommand: config.get<string>('phpunitCommand', ''),
    configurationFile: config.get<string>('configurationFile', ''),
    workingDirectory: config.get<string>('workingDirectory', ''),
    additionalArgs: config.get<string[]>('additionalArgs', []),
    dockerEnable: config.get<boolean>('docker.enable', false),
    dockerCommand: config.get<string>('docker.command', 'docker'),
    dockerContainer: config.get<string>('docker.container', ''),
    dockerWorkspacePath: config.get<string>('docker.workspacePath', ''),
    dockerExecArgs: config.get<string[]>('docker.execArgs', []),
  };
}

function getConfig(scope?: vscode.ConfigurationScope): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('phpunitRunner', scope);
}

function addFileItemToHierarchy(fileItem: vscode.TestItem, workspaceFolder?: vscode.WorkspaceFolder): void {
  removeFileItem(fileItem.uri!);

  if (!workspaceFolder) {
    controller.items.add(fileItem);
    return;
  }

  const root = getOrCreateWorkspaceItem(workspaceFolder);
  const relativePath = path.relative(workspaceFolder.uri.fsPath, fileItem.uri!.fsPath);
  const segments = path.dirname(relativePath).split(path.sep).filter((segment) => segment && segment !== '.');

  let parent = root;
  const folderSegments: string[] = [];
  for (const segment of segments) {
    folderSegments.push(segment);
    const folderId = makeFolderItemId(workspaceFolder, folderSegments);
    let folderItem = parent.children.get(folderId);
    if (!folderItem) {
      folderItem = controller.createTestItem(folderId, segment);
      parent.children.add(folderItem);
    }
    parent = folderItem;
  }

  parent.children.add(fileItem);
}

function findFileItem(uri: vscode.Uri): vscode.TestItem | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return controller.items.get(uri.toString());
  }

  const root = controller.items.get(makeWorkspaceItemId(workspaceFolder));
  if (!root) {
    return undefined;
  }

  const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  const segments = path.dirname(relativePath).split(path.sep).filter((segment) => segment && segment !== '.');

  let parent = root;
  const folderSegments: string[] = [];
  for (const segment of segments) {
    folderSegments.push(segment);
    const folderItem = parent.children.get(makeFolderItemId(workspaceFolder, folderSegments));
    if (!folderItem) {
      return undefined;
    }
    parent = folderItem;
  }

  return parent.children.get(uri.toString());
}

function removeFileItem(uri: vscode.Uri): void {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    controller.items.delete(uri.toString());
    return;
  }

  const rootId = makeWorkspaceItemId(workspaceFolder);
  const root = controller.items.get(rootId);
  if (!root) {
    return;
  }

  const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  const segments = path.dirname(relativePath).split(path.sep).filter((segment) => segment && segment !== '.');
  const ancestors: vscode.TestItem[] = [root];

  let parent = root;
  const folderSegments: string[] = [];
  for (const segment of segments) {
    folderSegments.push(segment);
    const folderItem = parent.children.get(makeFolderItemId(workspaceFolder, folderSegments));
    if (!folderItem) {
      return;
    }
    ancestors.push(folderItem);
    parent = folderItem;
  }

  parent.children.delete(uri.toString());

  for (let index = ancestors.length - 1; index > 0; index -= 1) {
    const folder = ancestors[index];
    if (folder.children.size > 0) {
      break;
    }
    ancestors[index - 1].children.delete(folder.id);
  }

  const refreshedRoot = controller.items.get(rootId);
  if (refreshedRoot && refreshedRoot.children.size === 0) {
    controller.items.delete(rootId);
  }
}

function getOrCreateWorkspaceItem(workspaceFolder: vscode.WorkspaceFolder): vscode.TestItem {
  const rootId = makeWorkspaceItemId(workspaceFolder);
  let root = controller.items.get(rootId);
  if (!root) {
    root = controller.createTestItem(rootId, workspaceFolder.name, workspaceFolder.uri);
    controller.items.add(root);
  }
  return root;
}

function makeWorkspaceItemId(workspaceFolder: vscode.WorkspaceFolder): string {
  return `workspace:${workspaceFolder.uri.toString()}`;
}

function makeFolderItemId(workspaceFolder: vscode.WorkspaceFolder, segments: string[]): string {
  return `folder:${workspaceFolder.uri.toString()}:${segments.join('/')}`;
}

function collectTestItems(collection: vscode.TestItemCollection): vscode.TestItem[] {
  const items: vscode.TestItem[] = [];
  collection.forEach((item) => {
    items.push(item);
  });
  return items;
}

function collectExecutableItems(item: vscode.TestItem): vscode.TestItem[] {
  return [item, ...collectMethodItems(item).filter((candidate) => candidate !== item)];
}

function collectMethodItems(item: vscode.TestItem): vscode.TestItem[] {
  const data = itemData.get(item);
  if (data?.kind === 'method') {
    return [item];
  }

  const methods: vscode.TestItem[] = [];
  for (const child of collectTestItems(item.children)) {
    methods.push(...collectMethodItems(child));
  }
  return methods;
}

function toVscodeRange(range: SourceRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character),
  );
}
