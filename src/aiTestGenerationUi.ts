import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  buildAiTestGenerationInvocation,
  buildTestGenerationPrompt,
  detectAiCliTools,
  extractGeneratedPhpTest,
  formatDetectedAiTools,
  isTestDestination,
  soleDetectedAiCli,
  suggestTestDestination,
  type AiCliTool,
} from './aiTestGeneration';
import { autoDetectConfigurationFile, autoDetectPhpUnit } from './invoke';
import { readFrameworkInfo } from './frameworkInfo';
import { firstCommandToken } from './commandAvailability';
import { runProcess } from './processRunner';

export async function showDetectedAiTools(output: vscode.OutputChannel): Promise<void> {
  const tools = await detectAiCliTools();
  output.appendLine('');
  output.appendLine(formatDetectedAiTools(tools));
  output.show(true);
}

export async function generateUnitTestsWithAi(
  output: vscode.OutputChannel,
  runCurrentFile: () => Promise<void>,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'php') {
    void vscode.window.showErrorMessage('Open a PHP source file before generating unit tests.');
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) {
    void vscode.window.showErrorMessage('Open the PHP project as a workspace folder before generating unit tests.');
    return;
  }

  const tools = await detectAiCliTools();
  if (tools.length === 0) {
    void vscode.window.showInformationMessage(
      'No supported AI CLI tools found. Install Codex CLI, GitHub Copilot CLI, or Claude Code and ensure it is on PATH.',
    );
    return;
  }

  const selected = editor.selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(editor.selection);
  if (!selected.trim()) {
    void vscode.window.showInformationMessage('Select PHP code or open a non-empty PHP file to generate tests.');
    return;
  }

  const choices = tools.map((tool) => ({
    label: `${tool.label}${tool.version ? ` · ${tool.version}` : tool.versionProbeFailed ? ' · version probe failed' : ''}`,
    description: tool.executablePath,
    tool,
  }));
  const onlyTool = soleDetectedAiCli(tools);
  const choice = onlyTool
    ? { tool: onlyTool }
    : await vscode.window.showQuickPick(choices, {
      title: 'Generate Unit Tests',
      placeHolder: 'Choose an installed AI CLI tool',
      matchOnDescription: true,
    });
  if (!choice) {
    return;
  }

  const sourcePath = path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath) || path.basename(editor.document.uri.fsPath);
  const context = await buildProjectContext(workspaceFolder, sourcePath);
  const consent = await vscode.window.showWarningMessage(
    `Send PHP source and test conventions to ${choice.tool.label}?`,
    {
      modal: true,
      detail: 'The selected local CLI may send this context to its configured AI provider. It runs from a temporary folder in read-only or planning mode; Copilot CLI also denies write, shell, and URL tools. You will review a diff before a test file is saved.',
    },
    'Continue',
  );
  if (consent !== 'Continue') {
    return;
  }

  const prompt = buildTestGenerationPrompt({
    framework: context.framework,
    sourcePath,
    sourceText: selected,
    projectGuidance: context.guidance,
  });
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit-runner-ai-'));
  try {
    const invocation = buildAiTestGenerationInvocation(choice.tool, prompt);
    output.appendLine(`Generating a ${context.framework} test with ${choice.tool.label}...`);
    let wasCancelled = false;
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Generating tests with ${choice.tool.label}`,
      cancellable: true,
    }, (_progress, token) => runProcess({
      command: invocation.command,
      args: invocation.args,
      shell: invocation.shell,
      cwd: tempDirectory,
      env: process.env,
      stdin: invocation.stdin,
      token,
      onOutput: (chunk) => output.append(chunk),
    }).finally(() => {
      wasCancelled = token.isCancellationRequested;
    }));

    if (wasCancelled) {
      output.appendLine('AI test generation cancelled.');
      return;
    }

    if (result.exitCode !== 0) {
      void vscode.window.showErrorMessage(
        `${choice.tool.label} exited with code ${result.exitCode}. See the PHPUnit Runner output for details.`,
      );
      output.show(true);
      return;
    }

    let generated: string;
    try {
      generated = extractGeneratedPhpTest(result.output);
    } catch (error) {
      output.appendLine(String(error));
      output.show(true);
      void vscode.window.showErrorMessage(String(error));
      return;
    }

    const destination = await chooseTestDestination(workspaceFolder, editor.document.uri.fsPath);
    if (!destination) {
      return;
    }
    const existingDocument = vscode.workspace.textDocuments.find((document) => (
      document.uri.fsPath === destination.fsPath
    ));
    if (existingDocument?.isDirty) {
      void vscode.window.showErrorMessage('Save the open test file before applying generated tests.');
      return;
    }
    const original = await readOptionalFile(destination.fsPath);
    const previewDirectory = path.join(tempDirectory, 'preview');
    await fs.mkdir(previewDirectory, { recursive: true });
    const originalPath = path.join(previewDirectory, 'current-test.php');
    const generatedPath = path.join(previewDirectory, path.basename(destination.fsPath));
    await Promise.all([
      fs.writeFile(originalPath, original ?? '', 'utf8'),
      fs.writeFile(generatedPath, generated, 'utf8'),
    ]);
    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(originalPath),
      vscode.Uri.file(generatedPath),
      `Review generated tests: ${path.basename(destination.fsPath)}`,
      { preview: false },
    );

    const relativeDestination = path.relative(workspaceFolder.uri.fsPath, destination.fsPath);
    const apply = await vscode.window.showWarningMessage(
      `Apply generated tests to ${relativeDestination}?`,
      { modal: true, detail: 'Only this PHP file inside the workspace tests folder will be created or replaced.' },
      'Apply Test File',
    );
    if (apply !== 'Apply Test File') {
      return;
    }

    await fs.mkdir(path.dirname(destination.fsPath), { recursive: true });
    await fs.writeFile(destination.fsPath, generated, 'utf8');
    const testDocument = await vscode.workspace.openTextDocument(destination);
    await vscode.window.showTextDocument(testDocument);
    const runNow = await vscode.window.showInformationMessage(
      `Generated test file saved: ${relativeDestination}`,
      'Run Test File',
    );
    if (runNow === 'Run Test File') {
      await runCurrentFile();
    }
  } catch (error) {
    output.appendLine(`AI test generation failed: ${String(error)}`);
    output.show(true);
    void vscode.window.showErrorMessage(`AI test generation failed: ${String(error)}`);
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

async function buildProjectContext(
  folder: vscode.WorkspaceFolder,
  sourcePath: string,
): Promise<{ framework: 'PHPUnit' | 'Pest'; guidance: string }> {
  const root = folder.uri.fsPath;
  const metadata = await readFrameworkInfo(root);
  const runner = firstCommandToken(await autoDetectPhpUnit(root));
  const framework: 'PHPUnit' | 'Pest' = /(?:^|[\\/])pest(?:\.bat|\.cmd|\.exe)?$/i.test(runner) || metadata.pestDeclared
    ? 'Pest'
    : 'PHPUnit';
  const frameworkPackage = framework === 'Pest' ? 'pestphp/pest' : 'phpunit/phpunit';
  const version = metadata.versions.get(frameworkPackage);
  const guidance = [`Framework: ${framework}${version ? ` ${version}` : ''}.`];

  try {
    const composer = JSON.parse(await fs.readFile(path.join(root, 'composer.json'), 'utf8')) as {
      'autoload-dev'?: unknown;
      scripts?: Record<string, unknown>;
    };
    const conventions = {
      autoloadDev: composer['autoload-dev'],
      testScripts: Object.fromEntries(Object.entries(composer.scripts ?? {}).filter(([name]) => /test|phpunit|pest/i.test(name))),
    };
    guidance.push(`Composer test conventions: ${JSON.stringify(conventions)}`);
  } catch {
    // Composer metadata is optional; framework detection still works without it.
  }

  const configuration = await autoDetectConfigurationFile(root);
  if (configuration) {
    const xml = await readOptionalFile(configuration);
    if (xml) {
      guidance.push(`PHPUnit configuration excerpt: ${xml.slice(0, 6_000)}`);
    }
  }

  const sampleFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, 'tests/**/*.php'),
    '**/{vendor,node_modules}/**',
    1,
  );
  const samplePath = sampleFiles.find((uri) => uri.fsPath !== path.resolve(root, sourcePath));
  if (samplePath) {
    const sample = await readOptionalFile(samplePath.fsPath);
    if (sample) {
      guidance.push(`Existing test example (${path.relative(root, samplePath.fsPath)}): ${sample.slice(0, 6_000)}`);
    }
  }

  return { framework, guidance: guidance.join('\n') };
}

async function chooseTestDestination(
  folder: vscode.WorkspaceFolder,
  sourceFilePath: string,
): Promise<vscode.Uri | undefined> {
  const existingTestFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, 'tests/**/*.php'),
    '**/{vendor,node_modules}/**',
    100,
  );
  const suggestedPath = suggestTestDestination(
    folder.uri.fsPath,
    sourceFilePath,
    existingTestFiles.map((uri) => uri.fsPath),
  );
  const uri = await vscode.window.showSaveDialog({
    title: 'Save Generated PHP Test File',
    defaultUri: vscode.Uri.file(suggestedPath),
    filters: { PHP: ['php'] },
  });
  if (!uri) {
    return undefined;
  }

  if (!isTestDestination(folder.uri.fsPath, uri.fsPath)) {
    void vscode.window.showErrorMessage('Generated tests must be saved as a PHP file inside the workspace tests folder.');
    return undefined;
  }
  if (path.resolve(uri.fsPath) === path.resolve(sourceFilePath)) {
    void vscode.window.showErrorMessage('Generated tests cannot overwrite the selected source file.');
    return undefined;
  }
  return uri;
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}
