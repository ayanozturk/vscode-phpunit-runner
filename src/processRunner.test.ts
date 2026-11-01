import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import * as vscode from 'vscode';
import { runProcess } from './processRunner';

class TestCancellationToken implements vscode.CancellationToken {
  private readonly emitter = new EventEmitter();
  isCancellationRequested = false;

  onCancellationRequested(listener: (e: void) => unknown): vscode.Disposable {
    this.emitter.on('cancel', listener);
    return { dispose: () => this.emitter.off('cancel', listener) };
  }

  cancel(): void {
    this.isCancellationRequested = true;
    this.emitter.emit('cancel');
  }
}

describe('runProcess', () => {
  it('collects stdout and stderr and returns the child exit code', async () => {
    const chunks: string[] = [];
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', "process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 7"],
      cwd: process.cwd(),
      env: process.env,
      token: new TestCancellationToken(),
      onOutput: (chunk) => chunks.push(chunk),
    });

    assert.equal(result.exitCode, 7);
    assert.match(result.output, /out/);
    assert.match(result.output, /err/);
    assert.equal(chunks.join(''), result.output);
  });

  it('writes an optional stdin payload and closes the stream', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => process.stdout.write(input))'],
      cwd: process.cwd(),
      stdin: 'selected PHP source',
      token: new TestCancellationToken(),
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.output, 'selected PHP source');
  });

  it('closes stdin when no payload is provided', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdin.on("end", () => process.stdout.write("stdin closed")); process.stdin.resume()'],
      cwd: process.cwd(),
      token: new TestCancellationToken(),
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.output, 'stdin closed');
  });

  it('preserves fixed argument arrays for shell-backed command shims', { skip: process.platform === 'win32' }, async () => {
    const result = await runProcess({
      command: '/bin/echo',
      args: ['fixed-argument', 'second-argument'],
      cwd: process.cwd(),
      shell: true,
      token: new TestCancellationToken(),
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.output, 'fixed-argument second-argument\n');
  });

  it('terminates a running process when its token is cancelled', async () => {
    const token = new TestCancellationToken();
    const running = runProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      token,
    });
    setTimeout(() => token.cancel(), 50);

    const result = await running;
    assert.equal(token.isCancellationRequested, true);
    assert.notEqual(result.exitCode, 0);
  });
});
