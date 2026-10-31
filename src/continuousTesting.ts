export type DebouncedTask = () => void | Promise<void>;

export type DebouncedTaskScheduler = {
  schedule: (key: string, task: DebouncedTask) => void;
  dispose: () => void;
};

export function createDebouncedTaskScheduler(delayMs: number): DebouncedTaskScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    schedule(key, task) {
      const current = timers.get(key);
      if (current) {
        clearTimeout(current);
      }

      timers.set(key, setTimeout(() => {
        timers.delete(key);
        void task();
      }, Math.max(0, delayMs)));
    },
    dispose() {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    },
  };
}
