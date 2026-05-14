import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

type TestMethod = {
  name: string;
  range: vscode.Range;
};

type TestClass = {
  name: string;
  fullyQualifiedName: string;
  range: vscode.Range;
  methods: TestMethod[];
};

type ParsedTestFile = {
  uri: vscode.Uri;
  classes: TestClass[];
};

type TestItemData = {
  kind: 'file' | 'class' | 'method';
  uri: vscode.Uri;
  className?: string;
  methodName?: string;
};

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
  const globs = config.get<string[]>('testFileGlobs', ['**/*Test.php', '**/tests/**/*.php']);
  const unique = new Map<string, vscode.Uri>();

  for (const pattern of globs) {
    const files = await vscode.workspace.findFiles(pattern);
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
  fileItem.range = new vscode.Range(0, 0, 0, 0);
  itemData.set(fileItem, { kind: 'file', uri });

  for (const cls of parsed.classes) {
    const classId = `${uri.toString()}::${cls.fullyQualifiedName}`;
    const classItem = controller.createTestItem(classId, cls.name, uri);
    classItem.range = cls.range;
    itemData.set(classItem, { kind: 'class', uri, className: cls.fullyQualifiedName });

    for (const method of cls.methods) {
      const methodId = `${classId}::${method.name}`;
      const methodItem = controller.createTestItem(methodId, method.name, uri);
      methodItem.range = method.range;
      itemData.set(methodItem, {
        kind: 'method',
        uri,
        className: cls.fullyQualifiedName,
        methodName: method.name,
      });
      classItem.children.add(methodItem);
    }

    fileItem.children.add(classItem);
  }

  addFileItemToHierarchy(fileItem, workspaceFolder);
}

async function parseTestFile(uri: vscode.Uri, text?: string): Promise<ParsedTestFile | undefined> {
  const source = text ?? await readFileText(uri);
  if (source === undefined) {
    return undefined;
  }

  const namespaceMatch = /^\s*namespace\s+([^;]+);/m.exec(source);
  const namespace = namespaceMatch?.[1]?.trim() ?? '';
  const lineStarts = getLineStarts(source);
  const classes: TestClass[] = [];

  const classPattern = /(?:final\s+|abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)[^\{]*\{/g;
  for (const match of source.matchAll(classPattern)) {
    const matchText = match[0];
    const className = match[1];
    const matchIndex = match.index ?? 0;
    const openBraceIndex = matchIndex + matchText.lastIndexOf('{');
    const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
    if (closeBraceIndex === -1) {
      continue;
    }

    const body = source.slice(openBraceIndex + 1, closeBraceIndex);
    const methods = parseTestMethods(body, openBraceIndex + 1, lineStarts);
    if (methods.length === 0) {
      continue;
    }

    const fqcn = namespace ? `${namespace}\\${className}` : className;
    classes.push({
      name: className,
      fullyQualifiedName: fqcn,
      range: rangeFromOffsets(lineStarts, matchIndex, closeBraceIndex),
      methods,
    });
  }

  return { uri, classes };
}

function parseTestMethods(body: string, bodyOffset: number, lineStarts: number[]): TestMethod[] {
  const methods: TestMethod[] = [];
  const methodPattern = /((?:\s*#\[[^\]]*Test[^\]]*\])|(?:\s*\/\*\*[\s\S]*?@test[\s\S]*?\*\/))?\s*(?:final\s+)?(?:public|protected)\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  const signaturePattern = /(?:final\s+)?(?:public|protected)\s+function\b/;

  for (const match of body.matchAll(methodPattern)) {
    const annotationBlock = match[1] ?? '';
    const methodName = match[2];
    const isTest = methodName.startsWith('test') || annotationBlock.includes('@test') || annotationBlock.includes('#[');
    if (!isTest) {
      continue;
    }

    const signatureOffset = match[0].search(signaturePattern);
    const start = bodyOffset + (match.index ?? 0) + Math.max(signatureOffset, 0);

    methods.push({
      name: methodName,
      range: rangeFromOffsets(lineStarts, start, start + match[0].length),
    });
  }

  return methods;
}

function getLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

function rangeFromOffsets(lineStarts: number[], start: number, end: number): vscode.Range {
  return new vscode.Range(positionFromOffset(lineStarts, start), positionFromOffset(lineStarts, end));
}

function positionFromOffset(lineStarts: number[], offset: number): vscode.Position {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const line = Math.max(high, 0);
  return new vscode.Position(line, Math.max(offset - lineStarts[line], 0));
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] ?? '';
    const prev = source[index - 1] ?? '';

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (prev === '*' && char === '/') {
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '/' && next === '/') {
        inLineComment = true;
        continue;
      }

      if (char === '/' && next === '*') {
        inBlockComment = true;
        continue;
      }
    }

    if (char === '\'' && !inDoubleQuote && prev !== '\\') {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote && prev !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
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
  if (item.children.size > 0) {
    for (const child of collectTestItems(item.children)) {
      await runItem(child, run, token);
    }
    return;
  }

  const data = itemData.get(item);
  if (!data) {
    return;
  }

  run.enqueued(item);
  run.started(item);

  try {
    const result = await executePhpUnit(data, token);
    const message = new vscode.TestMessage(result.output || 'PHPUnit completed without output.');
    run.appendOutput(result.output);

    if (result.exitCode === 0) {
      run.passed(item, result.duration);
      return;
    }

    run.failed(item, message, result.duration);
  } catch (error) {
    const message = new vscode.TestMessage(String(error));
    run.failed(item, message);
  }
}

async function executePhpUnit(data: TestItemData, token: vscode.CancellationToken): Promise<{ output: string; exitCode: number; duration: number }> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(data.uri);
  if (!workspaceFolder) {
    throw new Error(`No workspace folder found for ${data.uri.fsPath}`);
  }

  const invocation = await resolveInvocation(workspaceFolder, data);
  const start = Date.now();

  outputChannel.appendLine(`[phpunit-runner] ${[invocation.command, ...invocation.args].join(' ')}`);
  outputChannel.show(true);

  return await new Promise((resolve, reject) => {
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
        duration: Date.now() - start,
      });
    });
  });
}

async function resolveInvocation(workspaceFolder: vscode.WorkspaceFolder, data: TestItemData): Promise<{ command: string; args: string[]; cwd: string }> {
  const config = getConfig(workspaceFolder);
  const configuredCommand = config.get<string>('phpunitCommand', '').trim();
  const phpExecutable = config.get<string>('phpExecutable', 'php').trim() || 'php';
  const additionalArgs = config.get<string[]>('additionalArgs', []);
  const configuredWorkingDirectory = config.get<string>('workingDirectory', '').trim();
  const cwd = configuredWorkingDirectory
    ? resolvePath(workspaceFolder, configuredWorkingDirectory)
    : workspaceFolder.uri.fsPath;

  const configurationFile = config.get<string>('configurationFile', '').trim();
  const phpunitExecutable = configuredCommand || await autoDetectPhpUnit(workspaceFolder);
  const args: string[] = [];

  const needsPhp = isPhpScript(phpunitExecutable);
  const command = needsPhp ? phpExecutable : phpunitExecutable;
  if (needsPhp) {
    args.push(phpunitExecutable);
  }

  if (configurationFile) {
    args.push('--configuration', resolvePath(workspaceFolder, configurationFile));
  }

  args.push('--colors=always');
  args.push(...additionalArgs);

  if (data.className && data.methodName) {
    args.push('--filter', `^${escapeRegex(data.className)}::${escapeRegex(data.methodName)}$`);
  } else if (data.className) {
    args.push('--filter', `^${escapeRegex(data.className)}(?:::.*)?$`);
  }

  args.push(data.uri.fsPath);

  return { command, args, cwd };
}

async function autoDetectPhpUnit(workspaceFolder: vscode.WorkspaceFolder): Promise<string> {
  const candidates = process.platform === 'win32'
    ? ['vendor\\bin\\phpunit.bat', 'vendor\\bin\\phpunit']
    : ['vendor/bin/phpunit'];

  for (const candidate of candidates) {
    const resolved = path.join(workspaceFolder.uri.fsPath, candidate);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      continue;
    }
  }

  return 'phpunit';
}

function isPhpScript(command: string): boolean {
  const normalized = command.toLowerCase();
  return normalized.endsWith('/phpunit') || normalized.endsWith('\\phpunit') || normalized.endsWith('.php');
}

function resolvePath(workspaceFolder: vscode.WorkspaceFolder, targetPath: string): string {
  return path.isAbsolute(targetPath) ? targetPath : path.join(workspaceFolder.uri.fsPath, targetPath);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    const item = ancestors[index];
    if (item.children.size > 0) {
      break;
    }
    ancestors[index - 1].children.delete(item.id);
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