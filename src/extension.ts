import * as fs from 'fs/promises';
import { createServer } from 'net';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { unmapWithMappings, type PathMapping } from './commandTemplate';
import { testCodeLensTargets } from './codeLens';
import { readCloverReport } from './coverage';
import { createDebouncedTaskScheduler } from './continuousTesting';
import { buildGroupPickerOptions } from './groupPicker';
import { autoDetectConfigurationFile, resolveInvocation } from './invoke';
import { groupItemsBy, runGroupsSequentially } from './grouping';
import { terminateProcessTree } from './processTree';
import {
  aggregateMethodStatus,
  firstFailureLocation,
  firstFailureMessage,
  readJUnitReport,
} from './junit';
import { datasetSuffixFromTestCase, parseTestSource } from './parser';
import {
  formatTestOutputSegments,
  type OutputPreset,
  type TestOutputFormat,
} from './outputFormatter';
import { DEFAULT_EXCLUDE_GLOBS, DEFAULT_TEST_GLOBS } from './paths';
import { parsePhpUnitXml, resolveDiscoveryGlobs, type PhpUnitSuite } from './phpunitXml';
import { executionDisposition, unverifiedJUnitMessage } from './testResults';
import { resolveOutputFilePath } from './outputLocation';
import {
  findIndexedDatasetCases,
  findIndexedFileCases,
  findIndexedMethodCases,
  findIndexedPestCases,
  indexTestCases,
  type TestCaseIndex,
} from './resultIndex';
import { readFailureSourceSnippets as readSourceFailureSnippets } from './sourceSnippets';
import {
  findAcrossScopes,
  findWithGlobs as findWorkspaceFilesWithGlobs,
} from './workspaceDiscovery';
import type { JUnitTestCase, RunnerConfig, SourceRange, TestTarget } from './types';

type TestItemData = TestTarget & { uri: vscode.Uri; groups?: string[] };
type SuiteConfigCache = { xmlPath: string; modifiedAt: number; suites: PhpUnitSuite[] };

type ExtensionTestApi = {
  controller: vscode.TestController;
  profiles: vscode.TestRunProfile[];
  refresh: () => Promise<void>;
  runGroup: (group: string) => Promise<void>;
};

const itemData = new WeakMap<vscode.TestItem, TestItemData>();
const fileItemPaths = new Map<string, vscode.TestItem[]>();
const coverageDetails = new WeakMap<vscode.FileCoverage, vscode.FileCoverageDetail[]>();
const suiteConfigCache = new Map<string, SuiteConfigCache>();

let outputChannel: vscode.OutputChannel;
let controller: vscode.TestController;
let runProfile: vscode.TestRunProfile;
let lastIncludeIds: string[] | undefined;
let lastFailedIds: string[] = [];
let debugListenStarted = false;
let debugListenPort: number | undefined;
const continuousRuns = new Map<string, vscode.CancellationTokenSource>();

export async function activate(context: vscode.ExtensionContext): Promise<ExtensionTestApi | undefined> {
  outputChannel = vscode.window.createOutputChannel('PHPUnit Runner');
  controller = vscode.tests.createTestController('phpunitRunner', 'PHPUnit Runner');
  const continuousTestingScheduler = createDebouncedTaskScheduler(250);

  context.subscriptions.push(outputChannel, controller, { dispose: () => continuousTestingScheduler.dispose() });

  controller.resolveHandler = async (item) => {
    if (item) {
      await refreshTestItem(item);
      return;
    }

    await discoverWorkspaceTests();
  };

  runProfile = controller.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, runTests, true);
  const debugProfile = controller.createRunProfile('Debug Tests', vscode.TestRunProfileKind.Debug, runTests, true);
  const coverageProfile = controller.createRunProfile('Coverage Tests', vscode.TestRunProfileKind.Coverage, runTests, true);
  coverageProfile.loadDetailedCoverage = async (_run, fileCoverage) => coverageDetails.get(fileCoverage) ?? [];

  context.subscriptions.push(
    runProfile,
    debugProfile,
    coverageProfile,
    vscode.commands.registerCommand('phpunitRunner.refreshTests', async () => {
      await discoverWorkspaceTests();
    }),
    vscode.commands.registerCommand('phpunitRunner.runCurrentFile', async () => {
      await runCurrentFile();
    }),
    vscode.commands.registerCommand('phpunitRunner.runTestAtCursor', async () => {
      await runTestAtCursor();
    }),
    vscode.commands.registerCommand('phpunitRunner.runDiscoveredTest', async (uriString: string, itemId: string, debug: boolean) => {
      const uri = vscode.Uri.parse(uriString);
      const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uriString);
      await refreshUri(uri, openDocument?.getText());
      const item = findItemById(itemId);
      if (!item) {
        return;
      }
      const profile = debug ? debugProfile : runProfile;
      await runTests(new vscode.TestRunRequest([item], undefined, profile), new vscode.CancellationTokenSource().token);
    }),
    vscode.commands.registerCommand('phpunitRunner.runAll', async () => {
      await runTests(new vscode.TestRunRequest(undefined, undefined, runProfile), new vscode.CancellationTokenSource().token);
    }),
    vscode.commands.registerCommand('phpunitRunner.rerun', async () => {
      await rerunLast();
    }),
    vscode.commands.registerCommand('phpunitRunner.runFailed', async () => {
      await runFailedTests();
    }),
    vscode.commands.registerCommand('phpunitRunner.runByGroup', async () => {
      await runByGroup();
    }),
    vscode.commands.registerCommand('phpunitRunner.showOutput', () => {
      outputChannel.show();
    }),
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.languageId !== 'php') {
        return;
      }

      await refreshUri(document.uri, document.getText());
      if (getConfig(vscode.workspace.getWorkspaceFolder(document.uri)).get<boolean>('continuousTesting', false)) {
        continuousTestingScheduler.schedule(document.uri.toString(), async () => {
          if (getConfig(vscode.workspace.getWorkspaceFolder(document.uri)).get<boolean>('continuousTesting', false)) {
            await rerunSavedFile(document.uri);
          }
        });
      }
    }),
    vscode.workspace.onDidDeleteFiles(async (event) => {
      for (const uri of event.files) {
        removeFileItem(uri);
      }
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.php');
  const configWatcher = vscode.workspace.createFileSystemWatcher('**/phpunit.xml*');
  const composerLockWatcher = vscode.workspace.createFileSystemWatcher('**/composer.lock');
  const composerManifestWatcher = vscode.workspace.createFileSystemWatcher('**/composer.json');
  let composerRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleComposerRefresh = (uri: vscode.Uri) => {
    if (!vscode.workspace.getWorkspaceFolder(uri)) {
      return;
    }

    if (composerRefreshTimer) {
      clearTimeout(composerRefreshTimer);
    }
    composerRefreshTimer = setTimeout(() => {
      composerRefreshTimer = undefined;
      void discoverWorkspaceTests();
    }, 100);
  };
  const codeLensProvider: vscode.CodeLensProvider = {
    provideCodeLenses(document) {
      const parsed = parseTestSource(document.uri.fsPath, document.getText());
      return testCodeLensTargets(document.uri.toString(), parsed).flatMap(({ line, itemId }) => {
        const range = new vscode.Range(line, 0, line, 0);
        return [
          new vscode.CodeLens(range, {
            title: 'Run Test',
            command: 'phpunitRunner.runDiscoveredTest',
            arguments: [document.uri.toString(), itemId, false],
          }),
          new vscode.CodeLens(range, {
            title: 'Debug Test',
            command: 'phpunitRunner.runDiscoveredTest',
            arguments: [document.uri.toString(), itemId, true],
          }),
        ];
      });
    },
  };
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'php' }, codeLensProvider),
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
    configWatcher.onDidCreate(async (uri) => {
      await refreshForConfiguration(uri);
    }),
    configWatcher.onDidChange(async (uri) => {
      await refreshForConfiguration(uri);
    }),
    configWatcher.onDidDelete(async (uri) => {
      await refreshForConfiguration(uri);
    }),
    composerLockWatcher,
    { dispose: () => composerRefreshTimer && clearTimeout(composerRefreshTimer) },
    composerLockWatcher.onDidCreate(scheduleComposerRefresh),
    composerLockWatcher.onDidChange(scheduleComposerRefresh),
    composerLockWatcher.onDidDelete(scheduleComposerRefresh),
    composerManifestWatcher,
    composerManifestWatcher.onDidCreate(scheduleComposerRefresh),
    composerManifestWatcher.onDidChange(scheduleComposerRefresh),
    composerManifestWatcher.onDidDelete(scheduleComposerRefresh),
  );

  await discoverWorkspaceTests();
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return {
      controller,
      profiles: [runProfile, debugProfile, coverageProfile],
      refresh: discoverWorkspaceTests,
      runGroup: (group) => runByGroup(group),
    };
  }
}

export function deactivate(): void {
  outputChannel?.dispose();
}

async function discoverWorkspaceTests(): Promise<void> {
  const uris = await findCandidateTestFiles();
  controller.items.replace([]);
  fileItemPaths.clear();
  const suiteConfigLookups = new Map<string, Promise<SuiteConfigCache | undefined>>();
  await Promise.all(uris.map((uri) => refreshUri(uri, undefined, suiteConfigLookups)));
}

async function refreshForConfiguration(uri: vscode.Uri): Promise<void> {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) {
    suiteConfigCache.delete(folder.uri.fsPath);
  }
  await discoverWorkspaceTests();
}

async function findCandidateTestFiles(): Promise<vscode.Uri[]> {
  const config = getConfig();
  const configuredIncludes = config.get<string[]>('testFileGlobs', DEFAULT_TEST_GLOBS);
  const configuredExcludes = config.get<string[]>('excludeGlobs', DEFAULT_EXCLUDE_GLOBS);
  const unique = new Map<string, vscode.Uri>();

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return findWithGlobs(configuredIncludes, configuredExcludes, unique);
  }

  return findAcrossScopes(folders, async (folder) => {
    const xmlPath = await autoDetectConfigurationFile(folder.uri.fsPath);
    const xmlText = xmlPath ? await fs.readFile(xmlPath, 'utf8').catch(() => undefined) : undefined;
    const xmlDirectoryRelative = xmlPath
      ? path.relative(folder.uri.fsPath, path.dirname(xmlPath)) || '.'
      : '.';
    const resolved = resolveDiscoveryGlobs({
      configuredIncludes,
      configuredExcludes,
      xmlText,
      xmlDirectoryRelative,
    });
    return findWithGlobs(resolved.includeGlobs, resolved.excludeGlobs, new Map(), folder);
  }, (file) => file.toString());
}

async function findWithGlobs(
  includes: string[],
  excludes: string[],
  unique: Map<string, vscode.Uri>,
  folder?: vscode.WorkspaceFolder,
): Promise<vscode.Uri[]> {
  return findWorkspaceFilesWithGlobs(
    includes,
    excludes,
    unique,
    folder,
    async (pattern, excludeGlob, scope) => await vscode.workspace.findFiles(
      scope ? new vscode.RelativePattern(scope, pattern) : pattern,
      excludeGlob,
    ),
    (file) => file.toString(),
  );
}

async function findSuiteForFile(
  uri: vscode.Uri,
  folder: vscode.WorkspaceFolder,
  lookups?: Map<string, Promise<SuiteConfigCache | undefined>>,
): Promise<string | undefined> {
  const workspacePath = folder.uri.fsPath;
  let configLookup = lookups?.get(workspacePath);
  if (!configLookup) {
    configLookup = loadSuiteConfig(folder);
    lookups?.set(workspacePath, configLookup);
  }

  const cached = await configLookup;
  if (!cached) {
    return undefined;
  }

  const xmlDirectory = path.dirname(cached.xmlPath);
  const filePath = path.resolve(uri.fsPath);
  for (const suite of cached.suites) {
    const excluded = suite.excludes.some((exclude) => isPathInside(
      filePath,
      path.resolve(xmlDirectory, exclude),
    ));
    if (excluded) {
      continue;
    }

    const includesFile = suite.files.some((file) => path.resolve(xmlDirectory, file) === filePath);
    const includesDirectory = suite.directories.some((directory) => {
      const basePath = path.resolve(xmlDirectory, directory.path);
      const suffix = directory.suffix?.replace(/^\*/, '') || '.php';
      return isPathInside(filePath, basePath)
        && path.basename(filePath).endsWith(suffix);
    });
    if (includesFile || includesDirectory) {
      return suite.name;
    }
  }

  return undefined;
}

async function loadSuiteConfig(folder: vscode.WorkspaceFolder): Promise<SuiteConfigCache | undefined> {
  const workspacePath = folder.uri.fsPath;
  const xmlPath = await autoDetectConfigurationFile(workspacePath);
  if (!xmlPath) {
    suiteConfigCache.delete(workspacePath);
    return undefined;
  }

  let modifiedAt: number;
  try {
    modifiedAt = (await fs.stat(xmlPath)).mtimeMs;
  } catch {
    return undefined;
  }

  let cached = suiteConfigCache.get(workspacePath);
  if (!cached || cached.xmlPath !== xmlPath || cached.modifiedAt !== modifiedAt) {
    const xmlText = await fs.readFile(xmlPath, 'utf8').catch(() => undefined);
    if (xmlText === undefined) {
      return undefined;
    }
    cached = { xmlPath, modifiedAt, suites: parsePhpUnitXml(xmlText).suites };
    suiteConfigCache.set(workspacePath, cached);
  }
  return cached;
}

function isPathInside(filePath: string, directoryPath: string): boolean {
  const relative = path.relative(directoryPath, filePath);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function refreshTestItem(item: vscode.TestItem): Promise<void> {
  const data = itemData.get(item);
  if (!data) {
    return;
  }

  await refreshUri(data.uri);
}

async function refreshUri(
  uri: vscode.Uri,
  text?: string,
  suiteConfigLookups?: Map<string, Promise<SuiteConfigCache | undefined>>,
): Promise<void> {
  if (path.extname(uri.fsPath).toLowerCase() !== '.php') {
    return;
  }

  const parsed = await parseTestFile(uri, text);
  if (!parsed || parsed.classes.length === 0) {
    removeFileItem(uri);
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const suiteName = workspaceFolder
    ? await findSuiteForFile(uri, workspaceFolder, suiteConfigLookups)
    : undefined;
  const label = path.basename(uri.fsPath);

  const fileItem = controller.createTestItem(uri.toString(), label, uri);
  itemData.set(fileItem, { kind: 'file', uri, filePath: uri.fsPath });

  for (const cls of parsed.classes) {
    const classId = `${uri.toString()}::${cls.fullyQualifiedName}`;
    const classItem = controller.createTestItem(classId, cls.name, uri);
    classItem.range = toVscodeRange(cls.range);
    if (!cls.container) {
      itemData.set(classItem, {
        kind: 'class',
        uri,
        filePath: uri.fsPath,
        ...(cls.methods.some((method) => method.pestTestName)
          ? {}
          : { className: cls.fullyQualifiedName }),
      });
    }

    const methodsByRange = new Map<string, typeof cls.methods>();
    for (const method of cls.methods) {
      const rangeKey = `${method.range.start.line}:${method.range.start.character}:${method.range.end.line}:${method.range.end.character}`;
      const methods = methodsByRange.get(rangeKey) ?? [];
      methods.push(method);
      methodsByRange.set(rangeKey, methods);
    }

    for (const methods of methodsByRange.values()) {
      const method = methods.find((candidate) => !candidate.pestDatasetName && !candidate.phpunitDatasetName) ?? methods[0];
      const methodId = `${classId}::${method.name}`;
      const methodItem = controller.createTestItem(methodId, method.name, uri);
      methodItem.range = toVscodeRange(method.range);
      itemData.set(methodItem, {
        kind: 'method',
        uri,
        filePath: uri.fsPath,
        className: cls.fullyQualifiedName,
        methodName: method.name,
        pestTestName: method.pestTestName,
        pestDatasetName: method.pestDatasetName,
        groups: method.groups,
      });
      methodItem.tags = method.groups.map((group) => new vscode.TestTag(`group:${group}`));

      for (const dataset of methods.filter((candidate) => (
        candidate !== method && (candidate.pestDatasetName || candidate.phpunitDatasetName)
      ))) {
        if (dataset.phpunitDatasetName) {
          const datasetId = `${methodItem.id}::dataset:${dataset.phpunitDatasetName}`;
          const datasetItem = controller.createTestItem(datasetId, dataset.name, uri);
          datasetItem.range = toVscodeRange(dataset.range);
          itemData.set(datasetItem, {
            kind: 'dataset',
            uri,
            filePath: uri.fsPath,
            className: cls.fullyQualifiedName,
            methodName: method.name,
            datasetName: `${method.name} ${dataset.phpunitDatasetName}`,
            groups: dataset.groups,
          });
          datasetItem.tags = dataset.groups.map((group) => new vscode.TestTag(`group:${group}`));
          methodItem.children.add(datasetItem);
          continue;
        }

        const datasetId = `${classId}::${dataset.name}`;
        const datasetItem = controller.createTestItem(datasetId, dataset.name, uri);
        datasetItem.range = toVscodeRange(dataset.range);
        itemData.set(datasetItem, {
          kind: 'method',
          uri,
          filePath: uri.fsPath,
          className: cls.fullyQualifiedName,
          methodName: dataset.name,
          pestTestName: dataset.pestTestName,
          pestDatasetName: dataset.pestDatasetName,
          groups: dataset.groups,
        });
        datasetItem.tags = dataset.groups.map((group) => new vscode.TestTag(`group:${group}`));
        methodItem.children.add(datasetItem);
      }

      classItem.children.add(methodItem);
    }

    fileItem.children.add(classItem);
  }

  addFileItemToHierarchy(fileItem, workspaceFolder, suiteName);
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

async function rerunSavedFile(uri: vscode.Uri): Promise<void> {
  const item = findFileItem(uri);
  if (!item) {
    return;
  }

  const key = uri.toString();
  continuousRuns.get(key)?.cancel();
  const cancellation = new vscode.CancellationTokenSource();
  continuousRuns.set(key, cancellation);
  try {
    await runTests(new vscode.TestRunRequest([item]), cancellation.token);
  } finally {
    if (continuousRuns.get(key) === cancellation) {
      continuousRuns.delete(key);
    }
    cancellation.dispose();
  }
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
  clearOutputForRun(outputFoldersForRequest(request));
  await maybeSaveBeforeTest();
  const run = controller.createTestRun(request);
  const cancellation = new vscode.CancellationTokenSource();
  const tokenSubscription = token.onCancellationRequested(() => cancellation.cancel());
  const runSubscription = run.token.onCancellationRequested(() => cancellation.cancel());
  const queue = request.include?.length ? [...request.include] : collectTestItems(controller.items);
  const selectedFilesByWorkspace = new Map<string, vscode.TestItem[]>();
  for (const item of queue) {
    const data = itemData.get(item);
    const workspaceFolder = data?.kind === 'file' ? vscode.workspace.getWorkspaceFolder(data.uri) : undefined;
    if (!workspaceFolder) {
      continue;
    }
    const files = selectedFilesByWorkspace.get(workspaceFolder.uri.fsPath) ?? [];
    files.push(item);
    selectedFilesByWorkspace.set(workspaceFolder.uri.fsPath, files);
  }
  const processedFileIds = new Set<string>();
  lastIncludeIds = request.include?.map((item) => item.id);
  lastFailedIds = [];
  debugListenStarted = false;
  debugListenPort = undefined;
  const kind = request.profile?.kind ?? vscode.TestRunProfileKind.Run;

  try {
    if (token.isCancellationRequested || run.token.isCancellationRequested) {
      cancellation.cancel();
    }
    for (const item of queue) {
      if (cancellation.token.isCancellationRequested) {
        break;
      }

      const data = itemData.get(item);
      const workspaceFolder = data?.kind === 'file' ? vscode.workspace.getWorkspaceFolder(data.uri) : undefined;
      const selectedFiles = workspaceFolder
        ? selectedFilesByWorkspace.get(workspaceFolder.uri.fsPath) ?? []
        : [];
      if (selectedFiles.length > 1 && data?.kind === 'file') {
        if (!processedFileIds.has(item.id)) {
          for (const file of selectedFiles) {
            processedFileIds.add(file.id);
          }
          await runFileScope(item, selectedFiles, run, cancellation.token, kind);
        }
      } else {
        await runItem(item, run, cancellation.token, kind);
      }
    }
  } finally {
    tokenSubscription.dispose();
    runSubscription.dispose();
    cancellation.dispose();
    run.end();
  }
}

async function runItem(
  item: vscode.TestItem,
  run: vscode.TestRun,
  token: vscode.CancellationToken,
  kind: vscode.TestRunProfileKind,
): Promise<void> {
  const data = itemData.get(item);
  if (!data && item.children.size > 0) {
    const files = collectTestItems(item.children)
      .flatMap((child) => collectFileItems(child))
      .filter((fileItem, index, all) => all.findIndex((candidate) => candidate.id === fileItem.id) === index);
    if (files.length > 0) {
      await runFileScope(item, files, run, token, kind);
    }
    return;
  }

  if (!data) {
    return;
  }

  run.enqueued(item);
  run.started(item);

  try {
    const result = await executePhpUnit(data, token, kind, run);
    const folder = vscode.workspace.getWorkspaceFolder(data.uri);
    const outputPreset = getOutputPreset(folder);
    const outputFormat = getOutputFormat(folder);
    const sourceSnippets = outputPreset === 'progress' || outputPreset === 'summary' || outputFormat.sourceSnippet === false
      ? new Map<string, string>()
      : await readFailureSourceSnippets(result.cases, folder);
    await appendStructuredTestOutput(
      run,
      result.cases,
      outputPreset,
      result.output,
      sourceSnippets,
      outputFormat,
      folder,
    );
    if (result.reportWarning) {
      run.appendOutput(`${result.reportWarning}\r\n`, undefined, item);
    }
    applyExecutionResult(run, item, result);
  } catch (error) {
    const message = new vscode.TestMessage(String(error));
    if (token.isCancellationRequested) {
      run.skipped(item);
      markDescendants(run, item, 'skipped');
    } else {
      run.failed(item, message);
      markDescendants(run, item, 'skipped');
    }
  }
}

async function runFileScope(
  scope: vscode.TestItem,
  files: vscode.TestItem[],
  run: vscode.TestRun,
  token: vscode.CancellationToken,
  kind: vscode.TestRunProfileKind,
): Promise<void> {
  const firstFileData = itemData.get(files[0]);
  if (!firstFileData) {
    return;
  }

  const scopeIsExecutable = itemData.has(scope);
  const activeItems = scopeIsExecutable ? files : [scope];
  for (const activeItem of activeItems) {
    run.enqueued(activeItem);
    run.started(activeItem);
  }

  try {
    const scopeData: TestItemData = {
      ...firstFileData,
      filePath: undefined,
      filePaths: files.flatMap((file) => {
        const filePath = itemData.get(file)?.filePath;
        return filePath ? [filePath] : [];
      }),
    };
    const result = await executePhpUnit(scopeData, token, kind, run);
    const folder = vscode.workspace.getWorkspaceFolder(firstFileData.uri);
    const outputPreset = getOutputPreset(folder);
    const outputFormat = getOutputFormat(folder);
    const sourceSnippets = outputPreset === 'progress' || outputPreset === 'summary' || outputFormat.sourceSnippet === false
      ? new Map<string, string>()
      : await readFailureSourceSnippets(result.cases, folder);
    await appendStructuredTestOutput(
      run,
      result.cases,
      outputPreset,
      result.output,
      sourceSnippets,
      outputFormat,
      folder,
    );
    if (result.reportWarning) {
      run.appendOutput(`${result.reportWarning}\r\n`, undefined, scope);
    }

    const caseIndex = indexTestCases(result.cases, folder?.uri.fsPath);
    for (const file of files) {
      const fileCases = casesForFile(caseIndex, file);
      applyExecutionResult(run, file, {
        ...result,
        cases: fileCases,
        exitCode: fileCases.some((testCase) => testCase.status === 'failed' || testCase.status === 'errored') ? 1 : 0,
      });
    }
    if (!scopeIsExecutable) {
      const disposition = executionDisposition({
        cancelled: result.cancelled,
        exitCode: result.exitCode,
        caseCount: result.cases.length,
      });
      if (disposition === 'cancelled' || disposition === 'unverified') {
        run.skipped(scope);
      } else if (result.cases.some((testCase) => testCase.status === 'failed' || testCase.status === 'errored')
        || result.exitCode !== 0) {
        run.failed(scope, new vscode.TestMessage(result.output || 'One or more PHPUnit tests failed.'), result.duration);
      } else {
        run.passed(scope, result.duration);
      }
    }
  } catch (error) {
    const message = new vscode.TestMessage(String(error));
    for (const file of files) {
      if (token.isCancellationRequested) {
        run.skipped(file);
        markDescendants(run, file, 'skipped');
      } else {
        run.failed(file, message);
        markDescendants(run, file, 'skipped');
      }
    }
    if (!scopeIsExecutable) {
      if (token.isCancellationRequested) {
        run.skipped(scope);
      } else {
        run.failed(scope, message);
      }
    }
  }
}

function collectFileItems(item: vscode.TestItem): vscode.TestItem[] {
  const data = itemData.get(item);
  if (data?.kind === 'file') {
    return [item];
  }
  return collectTestItems(item.children).flatMap((child) => collectFileItems(child));
}

function casesForFile(index: TestCaseIndex, file: vscode.TestItem): JUnitTestCase[] {
  const fileData = itemData.get(file);
  if (!fileData?.filePath) {
    return [];
  }
  const classNames = new Set(collectMethodItems(file).flatMap((item) => {
    const className = itemData.get(item)?.className;
    return className ? [className] : [];
  }));
  return findIndexedFileCases(index, fileData.filePath, classNames);
}

function applyExecutionResult(
  run: vscode.TestRun,
  item: vscode.TestItem,
  result: { output: string; exitCode: number; duration: number; cases: JUnitTestCase[]; reportWarning?: string; cancelled?: boolean },
  caseIndex: TestCaseIndex = indexTestCases(
    result.cases,
    vscode.workspace.getWorkspaceFolder(item.uri ?? vscode.Uri.file(process.cwd()))?.uri.fsPath,
  ),
): void {
  let methods = collectMethodItems(item);
  for (const methodItem of methods) {
    const data = itemData.get(methodItem);
    if (data?.kind === 'method' && data.className && data.methodName && !data.pestTestName) {
      syncDatasetItems(run, methodItem, data, findIndexedMethodCases(caseIndex, data.className, data.methodName));
    }
  }
  methods = collectMethodItems(item);
  const disposition = executionDisposition({
    cancelled: result.cancelled,
    exitCode: result.exitCode,
    caseCount: result.cases.length,
  });
  if (disposition === 'cancelled') {
    run.skipped(item);
    markDescendants(run, item, 'skipped');
    return;
  }
  const unverifiedMessage = disposition === 'unverified'
    ? unverifiedJUnitMessage(result.exitCode, result.reportWarning)
    : undefined;
  if (unverifiedMessage) {
    if (!result.reportWarning) {
      run.appendOutput(`${unverifiedMessage}\r\n`, undefined, item);
    }
    run.skipped(item);
    markDescendants(run, item, 'skipped');
    return;
  }

  if (result.cases.length === 0 || methods.length === 0) {
    const message = new vscode.TestMessage(result.output || 'PHPUnit completed without output.');
    if (result.exitCode === 0) {
      run.passed(item, result.duration);
      markDescendants(run, item, 'passed', result.duration);
      return;
    }

    run.failed(item, message, result.duration);
    markDescendants(run, item, 'skipped');
    lastFailedIds.push(item.id);
    return;
  }

  let anyFailed = false;

  for (const methodItem of methods) {
    const data = itemData.get(methodItem);
    const className = data?.className;
    const methodName = data?.methodName;
    const datasetName = data?.datasetName;
    if (!data || !className || !methodName) {
      continue;
    }

    const cases = data.kind === 'dataset' && datasetName
      ? findIndexedDatasetCases(caseIndex, className, datasetName)
      : data.pestTestName
        ? findIndexedPestCases(caseIndex, data.pestTestName, data.uri.fsPath)
        : findIndexedMethodCases(caseIndex, className, methodName);
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
    lastFailedIds.push(methodItem.id);
    run.failed(methodItem, createFailureMessage(methodItem, cases), duration);
  }

  const data = itemData.get(item);
  if (data?.kind === 'method' || data?.kind === 'dataset') {
    return;
  }

  if (anyFailed || result.exitCode !== 0) {
    run.failed(item, new vscode.TestMessage(result.output || 'One or more PHPUnit tests failed.'), result.duration);
    return;
  }

  run.passed(item, result.duration);
}

function syncDatasetItems(
  run: vscode.TestRun,
  methodItem: vscode.TestItem,
  methodData: TestItemData,
  cases: JUnitTestCase[],
): void {
  const datasets = cases.flatMap((testCase) => {
    const suffix = methodData.methodName
      ? datasetSuffixFromTestCase(testCase.name, methodData.methodName)
      : undefined;
    return suffix ? [{ testCase, suffix }] : [];
  });
  const datasetIds = new Set<string>();

  for (const { testCase, suffix } of datasets) {
    const id = `${methodItem.id}::dataset:${suffix}`;
    datasetIds.add(id);
    let datasetItem = methodItem.children.get(id);
    if (!datasetItem) {
      const label = suffix.replace(/^with data set\s*/, '');
      datasetItem = controller.createTestItem(id, label, methodData.uri);
      datasetItem.range = methodItem.range;
      methodItem.children.add(datasetItem);
      run.enqueued(datasetItem);
      run.started(datasetItem);
    }
    itemData.set(datasetItem, {
      kind: 'dataset',
      uri: methodData.uri,
      filePath: methodData.filePath,
      className: methodData.className,
      methodName: methodData.methodName,
      datasetName: testCase.name,
      groups: methodData.groups,
    });
  }

  const staleItems: string[] = [];
  methodItem.children.forEach((child) => {
    if (itemData.get(child)?.kind === 'dataset' && !datasetIds.has(child.id)) {
      staleItems.push(child.id);
    }
  });
  for (const id of staleItems) {
    const staleItem = methodItem.children.get(id);
    if (staleItem) {
      run.skipped(staleItem);
      methodItem.children.delete(id);
    }
  }
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
  kind: vscode.TestRunProfileKind,
  run: vscode.TestRun,
): Promise<{
  output: string;
  exitCode: number;
  duration: number;
  cases: JUnitTestCase[];
  reportWarning?: string;
  cancelled?: boolean;
}> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(data.uri)
    ?? vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error(`No workspace folder found for ${data.uri.fsPath}`);
  }

  const debug = kind === vscode.TestRunProfileKind.Debug;
  const coverage = kind === vscode.TestRunProfileKind.Coverage;
  const runnerDir = path.join(workspaceFolder.uri.fsPath, '.phpunit-runner');
  await fs.mkdir(runnerDir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const junitLogPath = path.join(runnerDir, `junit-${stamp}.xml`);
  const coverageCloverPath = coverage ? path.join(runnerDir, `clover-${stamp}.xml`) : undefined;

  const config = readRunnerConfig(workspaceFolder);
  if (debug) {
    await ensureDebugListen(workspaceFolder, config);
  }

  const invocation = await resolveInvocation({
    workspacePath: workspaceFolder.uri.fsPath,
    target: data,
    config,
    junitLogPath,
    coverageCloverPath,
    debug,
    detectedConfigurationFile: config.configurationFile
      ? undefined
      : await autoDetectConfigurationFile(workspaceFolder.uri.fsPath),
  });
  const start = Date.now();

  outputChannel.appendLine(`[phpunit-runner] ${invocation.shell
    ? invocation.command
    : [invocation.command, ...invocation.args].join(' ')}`);

  try {
    const result = await new Promise<{ output: string; exitCode: number }>((resolve, reject) => {
      const env = {
        ...process.env,
        ...invocation.env,
      };
      const detached = process.platform !== 'win32';
      const child = invocation.shell
        ? spawn(invocation.command, { cwd: invocation.cwd, env, shell: true, detached })
        : spawn(invocation.command, invocation.args, { cwd: invocation.cwd, env, detached });

      let output = '';
      const append = (chunk: string | Buffer) => {
        const text = chunk.toString();
        output += text;
        outputChannel.append(text);
      };

      child.stdout.on('data', append);
      child.stderr.on('data', append);

      let terminationRequested = false;
      const terminateChildProcessTree = () => {
        if (terminationRequested) {
          return;
        }
        terminationRequested = true;
        terminateProcessTree(child);
      };

      const subscription = token.onCancellationRequested(terminateChildProcessTree);
      if (token.isCancellationRequested) {
        terminateChildProcessTree();
      }

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

    const junitReport = await readJUnitReport(junitLogPath);
    const remoteExecution = invocation.shell === true || config.dockerEnable;
    const reportWarning = junitReport.warning ?? (remoteExecution && !junitReport.available
      ? 'Remote PHPUnit execution completed, but its JUnit report is unavailable on the host. Detailed test results require a shared or mounted report path, or retrieval by the remote command.'
      : undefined);
    const cases = remapCases(junitReport.cases, invocation.mappings ?? []);
    if (coverageCloverPath) {
      await applyCloverCoverage(run, coverageCloverPath, invocation.mappings ?? [], remoteExecution);
    }
    return {
      ...result,
      duration: Date.now() - start,
      cases,
      reportWarning,
      cancelled: token.isCancellationRequested,
    };
  } finally {
    await fs.rm(junitLogPath, { force: true }).catch(() => undefined);
    if (coverageCloverPath) {
      await fs.rm(coverageCloverPath, { force: true }).catch(() => undefined);
    }
  }
}

async function ensureDebugListen(folder: vscode.WorkspaceFolder, config: RunnerConfig): Promise<void> {
  if (debugListenStarted) {
    if (debugListenPort !== undefined) {
      config.xdebugPort = debugListenPort;
    }
    return;
  }

  if (config.xdebugPort === 0) {
    config.xdebugPort = config.debuggerConfig.trim() ? 9003 : await findAvailablePort();
  }
  debugListenPort = config.xdebugPort;
  debugListenStarted = true;

  const named = config.debuggerConfig.trim();
  const launched = named
    ? await vscode.debug.startDebugging(folder, named)
    : await vscode.debug.startDebugging(folder, {
      type: 'php',
      request: 'launch',
      name: 'Listen for Xdebug (PHPUnit Runner)',
      port: config.xdebugPort || 9003,
    });

  if (!launched) {
    void vscode.window.showWarningMessage(
      'Could not start a PHP debug listener. Install a PHP debug extension or set phpunitRunner.debuggerConfig to a launch.json name.',
    );
  }
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  if (!address || typeof address === 'string') {
    throw new Error('Could not determine an available Xdebug port.');
  }
  return address.port;
}

async function applyCloverCoverage(
  run: vscode.TestRun,
  cloverPath: string,
  mappings: PathMapping[],
  remoteExecution: boolean,
): Promise<void> {
  const report = await readCloverReport(cloverPath, mappings);
  if (!report.available) {
    const message = remoteExecution
      ? `Remote coverage report is unavailable on the host. Coverage requires a shared or mounted report path, or retrieval by the remote command: ${report.warning}`
      : `Coverage report was not produced: ${report.warning}`;
    outputChannel.appendLine(`[phpunit-runner] ${message}`);
    run.appendOutput(`${message}\r\n`);
    return;
  }

  for (const file of report.files) {
    const uri = vscode.Uri.file(file.path);
    const details = file.details.map((line) => new vscode.StatementCoverage(
      line.count,
      new vscode.Position(Math.max(line.line - 1, 0), 0),
    ));
    const coverage = details.length > 0
      ? vscode.FileCoverage.fromDetails(uri, details)
      : new vscode.FileCoverage(
        uri,
        new vscode.TestCoverageCount(file.coveredStatements, file.statements),
      );
    coverageDetails.set(coverage, details);
    run.addCoverage(coverage);
  }
}

async function rerunLast(): Promise<void> {
  if (lastIncludeIds === undefined) {
    await runTests(new vscode.TestRunRequest(undefined, undefined, runProfile), new vscode.CancellationTokenSource().token);
    return;
  }

  const items = lastIncludeIds.map((id) => findItemById(id)).filter((item): item is vscode.TestItem => Boolean(item));
  await runTests(new vscode.TestRunRequest(items, undefined, runProfile), new vscode.CancellationTokenSource().token);
}

async function runFailedTests(): Promise<void> {
  const items = lastFailedIds.map((id) => findItemById(id)).filter((item): item is vscode.TestItem => Boolean(item));
  if (items.length === 0) {
    void vscode.window.showInformationMessage('No failed PHPUnit tests to re-run.');
    return;
  }

  await runTests(new vscode.TestRunRequest(items, undefined, runProfile), new vscode.CancellationTokenSource().token);
}

async function runByGroup(groupOverride?: string): Promise<void> {
  const groupOccurrences = collectAllMethodItems().flatMap((item) => {
    const data = itemData.get(item);
    if (data?.kind !== 'method') {
      return [];
    }

    const workspaceId = item.uri ? vscode.workspace.getWorkspaceFolder(item.uri)?.uri.toString() : undefined;
    return (data.groups ?? []).map((group) => ({ group, methodId: item.id, workspaceId }));
  });
  const options = buildGroupPickerOptions(groupOccurrences);
  if (options.length === 0) {
    void vscode.window.showInformationMessage('No PHPUnit @group or #[Group] attributes were found.');
    return;
  }

  const selected = groupOverride ?? await vscode.window.showQuickPick(options, { placeHolder: 'PHPUnit group' });
  if (!selected) {
    return;
  }
  const selectedGroup = typeof selected === 'string' ? selected : selected.groupName;

  const matching = collectAllMethodItems().filter((item) => itemData.get(item)?.groups?.includes(selectedGroup));
  const { groups: matchingByFolder, ungrouped: unscoped } = groupItemsBy(
    matching,
    (item) => item.uri ? vscode.workspace.getWorkspaceFolder(item.uri) : undefined,
  );
  if (matchingByFolder.size === 0 && unscoped.length === 0) {
    return;
  }

  clearOutputForRun([...matchingByFolder.keys(), ...(unscoped.length > 0 ? [undefined] : [])]);
  const request = new vscode.TestRunRequest(matching, undefined, runProfile);
  await maybeSaveBeforeTest([...matchingByFolder.keys()]);
  const run = controller.createTestRun(request);
  lastIncludeIds = matching.map((item) => item.id);
  lastFailedIds = [];
  debugListenStarted = false;
  for (const item of matching) {
    run.enqueued(item);
    run.started(item);
  }
  for (const item of unscoped) {
    run.errored(item, new vscode.TestMessage('The test is not inside a workspace folder.'));
  }

  const completedGroups = new Set<vscode.WorkspaceFolder>();
  try {
    await runGroupsSequentially(matchingByFolder, () => run.token.isCancellationRequested, async (folder, items) => {
      try {
        const result = await executePhpUnit(
          { kind: 'file', uri: folder.uri, group: selectedGroup },
          run.token,
          vscode.TestRunProfileKind.Run,
          run,
        );
        const outputPreset = getOutputPreset(folder);
        const outputFormat = getOutputFormat(folder);
        const sourceSnippets = outputPreset === 'progress' || outputPreset === 'summary' || outputFormat.sourceSnippet === false
          ? new Map<string, string>()
          : await readFailureSourceSnippets(result.cases, folder);
        await appendStructuredTestOutput(
          run,
          result.cases,
          outputPreset,
          result.output,
          sourceSnippets,
          outputFormat,
          folder,
        );
        if (result.reportWarning) {
          run.appendOutput(`${result.reportWarning}\r\n`);
        }
        const resultIndex = indexTestCases(result.cases, folder.uri.fsPath);
        for (const item of items) {
          applyExecutionResult(run, item, result, resultIndex);
        }
      } catch (error) {
        const message = new vscode.TestMessage(String(error));
        for (const item of items) {
          if (run.token.isCancellationRequested) {
            run.skipped(item);
          } else {
            run.errored(item, message);
          }
        }
      } finally {
        completedGroups.add(folder);
      }
    });
    if (run.token.isCancellationRequested) {
      for (const [folder, items] of matchingByFolder) {
        if (!completedGroups.has(folder)) {
          for (const item of items) {
            run.skipped(item);
          }
        }
      }
    }
  } finally {
    run.end();
  }
}

function collectAllMethodItems(): vscode.TestItem[] {
  return collectTestItems(controller.items).flatMap((item) => collectMethodItems(item));
}

function findItemById(id: string): vscode.TestItem | undefined {
  const stack = collectTestItems(controller.items);
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) {
      continue;
    }
    if (item.id === id) {
      return item;
    }
    stack.push(...collectTestItems(item.children));
  }
  return undefined;
}

function readRunnerConfig(scope?: vscode.ConfigurationScope): RunnerConfig {
  const config = getConfig(scope);
  return {
    phpExecutable: config.get<string>('phpExecutable', 'php'),
    phpunitCommand: config.get<string>('phpunitCommand', ''),
    configurationFile: config.get<string>('configurationFile', ''),
    workingDirectory: config.get<string>('workingDirectory', ''),
    additionalArgs: config.get<string[]>('additionalArgs', []),
    phpArgs: config.get<string[]>('phpArgs', []),
    command: config.get<string>('command', ''),
    paths: config.get<Record<string, string>>('paths', {}),
    environment: config.get<Record<string, string>>('environment', {}),
    saveBeforeTest: config.get<boolean>('saveBeforeTest', false),
    dockerEnable: config.get<boolean>('docker.enable', false),
    dockerCommand: config.get<string>('docker.command', 'docker'),
    dockerContainer: config.get<string>('docker.container', ''),
    dockerWorkspacePath: config.get<string>('docker.workspacePath', ''),
    dockerExecArgs: config.get<string[]>('docker.execArgs', []),
    debuggerConfig: config.get<string>('debuggerConfig', ''),
    xdebugPort: config.get<number>('xdebugPort', 9003),
  };
}

function getConfig(scope?: vscode.ConfigurationScope): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('phpunitRunner', scope);
}

function getOutputPreset(folder?: vscode.WorkspaceFolder): OutputPreset {
  const value = getConfig(folder).get<string>('output.preset', 'collision');
  return value === 'progress' || value === 'pretty' || value === 'summary' ? value : 'collision';
}

function getOutputFormat(folder?: vscode.WorkspaceFolder): TestOutputFormat {
  const value = getConfig(folder).get<unknown>('output.format', {});
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const format = value as Record<string, unknown>;
  const iconsValue = format.icons;
  const icons = iconsValue && typeof iconsValue === 'object' && !Array.isArray(iconsValue)
    ? iconsValue as TestOutputFormat['icons']
    : undefined;

  return {
    colors: typeof format.colors === 'boolean' ? format.colors : undefined,
    duration: typeof format.duration === 'boolean' ? format.duration : undefined,
    icons,
    testCase: typeof format.testCase === 'string' ? format.testCase : undefined,
    failureLocation: typeof format.failureLocation === 'string' ? format.failureLocation : undefined,
    failureMessage: typeof format.failureMessage === 'string' ? format.failureMessage : undefined,
    sourceSnippet: typeof format.sourceSnippet === 'boolean' ? format.sourceSnippet : undefined,
  };
}

async function readFailureSourceSnippets(
  cases: JUnitTestCase[],
  folder?: vscode.WorkspaceFolder,
): Promise<Map<string, string>> {
  const contextLines = getConfig(folder).get<number>('output.sourceSnippetContextLines', 1);
  return readSourceFailureSnippets(cases, folder?.uri.fsPath, undefined, contextLines);
}

async function appendStructuredTestOutput(
  run: vscode.TestRun,
  cases: JUnitTestCase[],
  preset: OutputPreset,
  fallbackOutput: string,
  sourceSnippets: ReadonlyMap<string, string>,
  format: TestOutputFormat,
  folder?: vscode.WorkspaceFolder,
): Promise<void> {
  const segments = formatTestOutputSegments(cases, preset, fallbackOutput, sourceSnippets, format);
  const output = segments.map((segment) => segment.text).join('');
  if (!output) {
    return;
  }

  // VS Code lays out each appendOutput call separately in the Test Results
  // pane. Keep a multi-case report together instead of scattering lines
  // across the available width. A single segment can still carry its link.
  const location = segments.length === 1
    ? await resolveOutputLocation(segments[0].location, folder)
    : undefined;
  run.appendOutput(output, location);
}

async function resolveOutputLocation(
  failureLocation: { file: string; line: number } | undefined,
  folder?: vscode.WorkspaceFolder,
): Promise<vscode.Location | undefined> {
  if (!failureLocation?.file || !Number.isInteger(failureLocation.line) || failureLocation.line < 1) {
    return undefined;
  }

  const { file, line } = failureLocation;
  const filePath = resolveOutputFilePath(file, line, folder?.uri.fsPath);
  if (!filePath) {
    return undefined;
  }

  try {
    await fs.access(filePath);
  } catch {
    return undefined;
  }

  const position = new vscode.Position(line - 1, 0);
  return new vscode.Location(vscode.Uri.file(filePath), new vscode.Range(position, position));
}

function outputFoldersForRequest(request: vscode.TestRunRequest): Array<vscode.WorkspaceFolder | undefined> {
  if (!request.include?.length) {
    return [...(vscode.workspace.workspaceFolders ?? [undefined])];
  }

  return request.include.flatMap(workspaceFoldersForItem);
}

function workspaceFoldersForItem(item: vscode.TestItem): Array<vscode.WorkspaceFolder | undefined> {
  const folder = item.uri ? vscode.workspace.getWorkspaceFolder(item.uri) : undefined;
  if (folder) {
    return [folder];
  }

  const children = collectTestItems(item.children);
  return children.length > 0
    ? children.flatMap(workspaceFoldersForItem)
    : [undefined];
}

function clearOutputForRun(folders: Array<vscode.WorkspaceFolder | undefined>): void {
  const uniqueFolders = new Map<string, vscode.WorkspaceFolder>();
  for (const folder of folders) {
    if (folder) {
      uniqueFolders.set(folder.uri.toString(), folder);
    }
  }

  const hasUnscopedItems = folders.some((folder) => !folder);
  const shouldClear = [...uniqueFolders.values()].some((folder) => (
    getConfig(folder).get<boolean>('clearOutputOnRun', true)
  )) || ((hasUnscopedItems || uniqueFolders.size === 0)
    && getConfig().get<boolean>('clearOutputOnRun', true));

  if (shouldClear) {
    outputChannel.clear();
  }
}

async function maybeSaveBeforeTest(folders = vscode.workspace.workspaceFolders ?? []): Promise<void> {
  if (folders.some((folder) => readRunnerConfig(folder).saveBeforeTest)) {
    await vscode.workspace.saveAll(false);
  }
}

function remapCases(cases: JUnitTestCase[], mappings: PathMapping[]): JUnitTestCase[] {
  if (mappings.length === 0) {
    return cases;
  }

  return cases.map((item) => ({
    ...item,
    file: item.file ? unmapWithMappings(item.file, mappings) : item.file,
    message: remapText(item.message, mappings),
  }));
}

function remapText(value: string, mappings: PathMapping[]): string {
  let result = value;
  for (const mapping of mappings) {
    result = result.split(mapping.to).join(mapping.from);
  }
  return result;
}

function addFileItemToHierarchy(
  fileItem: vscode.TestItem,
  workspaceFolder?: vscode.WorkspaceFolder,
  suiteName?: string,
): void {
  removeFileItem(fileItem.uri!);

  if (!workspaceFolder) {
    controller.items.add(fileItem);
    fileItemPaths.set(fileItem.id, [fileItem]);
    return;
  }

  const root = getOrCreateWorkspaceItem(workspaceFolder);
  const itemPath = [root];
  const relativePath = path.relative(workspaceFolder.uri.fsPath, fileItem.uri!.fsPath);
  const segments = path.dirname(relativePath).split(path.sep).filter((segment) => segment && segment !== '.');

  let parent = root;
  if (suiteName) {
    const suiteId = makeSuiteItemId(workspaceFolder, suiteName);
    let suiteItem = root.children.get(suiteId);
    if (!suiteItem) {
      suiteItem = controller.createTestItem(suiteId, suiteName, workspaceFolder.uri);
      itemData.set(suiteItem, {
        kind: 'suite',
        uri: workspaceFolder.uri,
        suiteName,
      });
      root.children.add(suiteItem);
    }
    parent = suiteItem;
    itemPath.push(suiteItem);
  }

  const folderSegments: string[] = [];
  for (const segment of segments) {
    folderSegments.push(segment);
    const folderId = makeFolderItemId(workspaceFolder, folderSegments, suiteName);
    let folderItem = parent.children.get(folderId);
    if (!folderItem) {
      folderItem = controller.createTestItem(folderId, segment);
      parent.children.add(folderItem);
    }
    parent = folderItem;
    itemPath.push(folderItem);
  }

  parent.children.add(fileItem);
  itemPath.push(fileItem);
  fileItemPaths.set(fileItem.id, itemPath);
}

function findFileItem(uri: vscode.Uri): vscode.TestItem | undefined {
  const itemPath = fileItemPaths.get(uri.toString());
  return itemPath?.[itemPath.length - 1];
}

function removeFileItem(uri: vscode.Uri): void {
  const itemPath = fileItemPaths.get(uri.toString());
  if (!itemPath || itemPath.length === 0) {
    return;
  }
  fileItemPaths.delete(uri.toString());

  if (itemPath.length === 1) {
    controller.items.delete(uri.toString());
    return;
  }

  const parent = itemPath[itemPath.length - 2];
  parent.children.delete(uri.toString());

  for (let index = itemPath.length - 2; index > 0; index -= 1) {
    const ancestor = itemPath[index];
    if (ancestor.children.size > 0) {
      break;
    }
    itemPath[index - 1].children.delete(ancestor.id);
  }

  if (itemPath[0].children.size === 0) {
    controller.items.delete(itemPath[0].id);
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

function makeSuiteItemId(workspaceFolder: vscode.WorkspaceFolder, suiteName: string): string {
  return `suite:${workspaceFolder.uri.toString()}:${suiteName}`;
}

function makeFolderItemId(workspaceFolder: vscode.WorkspaceFolder, segments: string[], suiteName?: string): string {
  const prefix = suiteName ? `${makeSuiteItemId(workspaceFolder, suiteName)}:` : `folder:${workspaceFolder.uri.toString()}:`;
  return `${prefix}${segments.join('/')}`;
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
  if (data?.kind === 'dataset') {
    return [item];
  }
  if (data?.kind === 'method') {
    return [item, ...collectTestItems(item.children).flatMap((child) => collectMethodItems(child))];
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
