import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'phpunit-runner-vscode-'));

try {
  const folders = [];
  for (const [name, className, methodName] of [
    ['workspace-a', 'AlphaTest', 'testAlpha'],
    ['workspace-b', 'BetaTest', 'testBeta'],
  ]) {
    const folder = path.join(fixtureRoot, name);
    await fs.mkdir(path.join(folder, 'tests'), { recursive: true });
    await fs.writeFile(path.join(folder, 'tests', `${className}.php`), `<?php
class ${className} {
    /** @group integration */
    public function ${methodName}(): void {}
}
`, 'utf8');
    folders.push({ path: name });
  }

  const workspaceFile = path.join(fixtureRoot, 'integration.code-workspace');
  await fs.writeFile(workspaceFile, JSON.stringify({ folders }, null, 2), 'utf8');
  let vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  if (process.platform === 'darwin') {
    const modernExecutablePath = path.join(path.dirname(vscodeExecutablePath), 'Code');
    try {
      await fs.access(vscodeExecutablePath);
    } catch {
      await fs.access(modernExecutablePath);
      vscodeExecutablePath = modernExecutablePath;
    }
  }
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: repository,
    extensionTestsPath: path.join(repository, 'test', 'vscode', 'suite.cjs'),
    launchArgs: [workspaceFile, '--disable-extensions', '--disable-gpu', '--no-sandbox'],
  });
} catch (error) {
  console.error('VS Code extension-host tests failed:', error);
  process.exitCode = 1;
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}
