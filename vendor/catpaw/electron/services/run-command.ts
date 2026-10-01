import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { currentRequestBudget } from '../network/http';

const active = new Set<ChildProcess>();
let stopping = false;
function stopProcess(child: ChildProcess) {
  // SIGTERM asks the supervisor to dispose its entire group. If the supervisor
  // has not loaded yet, SIGKILL of its private group is equally safe.
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
process.once('exit', () => { for (const child of active) stopProcess(child); });
for (const signal of ['SIGTERM', 'SIGINT', 'disconnect'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    const closed = [...active].map((child) => new Promise<void>((resolve) => {
      child.once('close', () => resolve());
      stopProcess(child);
    }));
    void Promise.all(closed).then(() => process.exit(signal === 'disconnect' ? 0 : signal === 'SIGTERM' ? 143 : 130));
  });
}

/** Bound external adapter commands to the same request lifetime as network calls. */
export function runCommand(command: string, args: string[], timeoutMs: number) {
  const budget = currentRequestBudget();
  if (stopping || budget?.shouldStop?.()) return Promise.reject(new Error('CANCELLED'));
  const remaining = Math.min(timeoutMs, (budget?.deadlineAt ?? Infinity) - Date.now());
  if (remaining <= 0) return Promise.reject(new Error('REQUEST_DEADLINE_EXCEEDED'));
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const isTs = __filename.endsWith('.ts');
    const child = fork(path.join(__dirname, `command-process.${isTs ? 'ts' : 'js'}`), [command, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      execArgv: isTs ? ['-r', 'tsx/cjs'] : [],
      stdio: process.env.CATPAW_WORKER_LIFETIME_FD === '4'
        ? ['ignore', 'pipe', 'pipe', 'ipc', 4] : ['ignore', 'pipe', 'pipe', 'ipc'],
      detached: process.platform !== 'win32',
    });
    active.add(child);
    let stdout = ''; let stderr = ''; let bytes = 0; let stopped: Error | undefined;
    let result: { code?: number | null; error?: string } | undefined;
    const stop = (message: string) => {
      if (stopped) return;
      stopped = new Error(message);
      stopProcess(child);
    };
    const timer = setTimeout(() => stop('REQUEST_DEADLINE_EXCEEDED'), remaining);
    const poll = setInterval(() => { if (budget?.shouldStop?.()) stop('CANCELLED'); }, 25);
    const clean = () => { clearTimeout(timer); clearInterval(poll); active.delete(child); };
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) { stop('COMMAND_OUTPUT_TOO_LARGE'); return; }
      if (target === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout!.on('data', (chunk) => collect('stdout', chunk));
    child.stderr!.on('data', (chunk) => collect('stderr', chunk));
    child.once('message', (message) => { result = message as typeof result; });
    child.once('error', (error) => { clean(); reject(error); });
    child.once('close', () => {
      clean();
      if (stopped) reject(stopped);
      else if (result?.error) reject(new Error(result.error));
      else if (result?.code !== 0) reject(new Error(stderr.trim() || stdout.trim() || `COMMAND_EXIT_${result?.code ?? 'UNKNOWN'}`));
      else resolve({ stdout, stderr, code: result.code });
    });
  });
}
