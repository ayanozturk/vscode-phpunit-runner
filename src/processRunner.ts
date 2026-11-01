import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { terminateProcessTree } from './processTree';

export type ProcessRunOptions = {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
  stdin?: string | Buffer;
  token: vscode.CancellationToken;
  onOutput?: (chunk: string) => void;
};

export type ProcessRunResult = { output: string; exitCode: number };

/** Runs a child process with shared output collection and cancellation behavior. */
export function runProcess(options: ProcessRunOptions): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: options.env,
      ...(options.shell ? { shell: true } : {}),
      detached: process.platform !== 'win32',
    });
    let output = '';
    let settled = false;
    let terminationRequested = false;
    const terminate = () => {
      if (terminationRequested) {
        return;
      }
      terminationRequested = true;
      terminateProcessTree(child);
    };
    const subscription = options.token.onCancellationRequested(terminate);

    const append = (chunk: string | Buffer) => {
      const text = chunk.toString();
      output += text;
      options.onOutput?.(text);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      subscription.dispose();
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      subscription.dispose();
      resolve({ output, exitCode: exitCode ?? 1 });
    });

    // Test and AI CLI invocations are non-interactive. Always close stdin so
    // child processes that optionally read piped input can finish promptly.
    child.stdin?.end(options.stdin);

    if (options.token.isCancellationRequested) {
      terminate();
    }
  });
}
