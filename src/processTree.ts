import { spawn, type ChildProcess } from 'child_process';

type ProcessTreeOptions = {
  platform?: NodeJS.Platform;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  startTaskkill?: (pid: number, fallback: () => void) => void;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  escalationDelayMs?: number;
};

export function terminateProcessTree(
  child: Pick<ChildProcess, 'pid' | 'kill'>,
  options: ProcessTreeOptions = {},
): ReturnType<typeof setTimeout> | undefined {
  const pid = child.pid;
  const fallback = (signal: NodeJS.Signals = 'SIGTERM') => child.kill(signal);
  if (!pid) {
    fallback();
    return undefined;
  }

  if ((options.platform ?? process.platform) === 'win32') {
    (options.startTaskkill ?? startTaskkill)(pid, () => fallback());
    return undefined;
  }

  const killProcess = options.killProcess ?? process.kill.bind(process);
  try {
    killProcess(-pid, 'SIGTERM');
  } catch {
    fallback();
    return undefined;
  }

  const schedule = options.schedule ?? setTimeout;
  const escalation = schedule(() => {
    try {
      killProcess(-pid, 'SIGKILL');
    } catch {
      fallback('SIGKILL');
    }
  }, options.escalationDelayMs ?? 1500);
  escalation.unref?.();
  return escalation;
}

function startTaskkill(pid: number, fallback: () => void): void {
  const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  let fallbackSent = false;
  const fallbackOnce = () => {
    if (fallbackSent) {
      return;
    }
    fallbackSent = true;
    fallback();
  };
  taskkill.on('error', fallbackOnce);
  taskkill.on('close', (code) => {
    if (code !== 0) {
      fallbackOnce();
    }
  });
}
