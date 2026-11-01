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
