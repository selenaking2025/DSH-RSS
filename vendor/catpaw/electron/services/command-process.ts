import { spawn, spawnSync } from 'node:child_process';

// This supervisor owns a private process group. Its IPC pipe is a lifeline:
// even SIGKILL of the requesting worker disconnects it and stops descendants.
function dispose() {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(process.pid), '/T', '/F'], { stdio: 'ignore' });
    process.exit(1);
  }
  process.kill(-process.pid, 'SIGKILL');
}
process.once('disconnect', dispose);
process.once('SIGTERM', dispose);
process.once('SIGINT', dispose);
if (!process.connected) dispose();

const [command, ...args] = process.argv.slice(2);
const commandEnv = { ...process.env };
delete commandEnv.CATPAW_WORKER_LIFETIME_FD;
const child = spawn(command, args, { env: commandEnv, stdio: ['ignore', 'inherit', 'inherit'] });
let finished = false;
function finish(result: { code?: number | null; error?: string }) {
  if (finished) return;
  finished = true;
  if (process.connected && process.send) process.send(result, dispose);
  else dispose();
}
child.once('error', (error) => finish({ error: error.message }));
// Use exit, not close: descendants may still hold inherited output pipes open.
child.once('exit', (code) => finish({ code }));
