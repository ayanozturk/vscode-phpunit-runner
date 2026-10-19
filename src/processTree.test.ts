import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { terminateProcessTree } from './processTree';

describe('terminateProcessTree', () => {
  it('signals the Unix process group and escalates when needed', () => {
    const signals: Array<[number, NodeJS.Signals]> = [];
    let scheduled: (() => void) | undefined;
    const timer = { unref() {} } as ReturnType<typeof setTimeout>;
    const child = { pid: 42, kill: () => true };

    const result = terminateProcessTree(child, {
      platform: 'linux',
      killProcess: (pid, signal) => signals.push([pid, signal]),
      schedule: (callback, delayMs) => {
        assert.equal(delayMs, 1500);
        scheduled = callback;
        return timer;
      },
    });

    assert.equal(result, timer);
    assert.deepEqual(signals, [[-42, 'SIGTERM']]);
    scheduled?.();
    assert.deepEqual(signals, [[-42, 'SIGTERM'], [-42, 'SIGKILL']]);
  });

  it('uses taskkill for Windows process trees and falls back to the child', () => {
    const taskkillPids: number[] = [];
    const signals: NodeJS.Signals[] = [];
    let fallback: (() => void) | undefined;
    const child = { pid: 84, kill: (signal?: NodeJS.Signals) => { signals.push(signal ?? 'SIGTERM'); return true; } };

    const result = terminateProcessTree(child, {
      platform: 'win32',
      startTaskkill: (pid, onFailure) => {
        taskkillPids.push(pid);
        fallback = onFailure;
      },
    });

    assert.equal(result, undefined);
    assert.deepEqual(taskkillPids, [84]);
    fallback?.();
    assert.deepEqual(signals, ['SIGTERM']);
  });

  it('falls back to killing the child when the Unix process group is unavailable', () => {
    const signals: NodeJS.Signals[] = [];
    const child = { pid: 12, kill: (signal?: NodeJS.Signals) => { signals.push(signal ?? 'SIGTERM'); return true; } };

    terminateProcessTree(child, {
      platform: 'linux',
      killProcess: () => { throw new Error('process group exited'); },
      schedule: () => { throw new Error('should not schedule escalation'); },
    });

    assert.deepEqual(signals, ['SIGTERM']);
  });
});
