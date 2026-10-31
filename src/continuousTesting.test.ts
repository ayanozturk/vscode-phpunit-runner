import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDebouncedTaskScheduler } from './continuousTesting';

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('continuous test scheduling', () => {
  it('coalesces rapid saves for the same file and runs the latest task', async () => {
    const scheduler = createDebouncedTaskScheduler(20);
    const calls: string[] = [];
    try {
      scheduler.schedule('/workspace/tests/ExampleTest.php', () => calls.push('first'));
      scheduler.schedule('/workspace/tests/ExampleTest.php', () => calls.push('latest'));
      await wait(50);

      assert.deepEqual(calls, ['latest']);
    } finally {
      scheduler.dispose();
    }
  });

  it('keeps pending runs independent across files', async () => {
    const scheduler = createDebouncedTaskScheduler(20);
    const calls: string[] = [];
    try {
      scheduler.schedule('/workspace/tests/FirstTest.php', () => calls.push('first'));
      scheduler.schedule('/workspace/tests/SecondTest.php', () => calls.push('second'));
      await wait(50);

      assert.deepEqual(calls.sort(), ['first', 'second']);
    } finally {
      scheduler.dispose();
    }
  });

  it('cancels pending runs when disposed', async () => {
    const scheduler = createDebouncedTaskScheduler(20);
    const calls: string[] = [];
    scheduler.schedule('/workspace/tests/ExampleTest.php', () => calls.push('unexpected'));
    scheduler.dispose();
    await wait(50);

    assert.deepEqual(calls, []);
  });
});
