import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { inspect } from 'node:util';
import { ensureUserDataDir } from '../runtime';

export function redactDiagnostic(value: string) {
  return value.split(os.homedir()).join('~')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/(?:sk-|sk_)[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
      try { const url = new URL(raw); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
      catch { return '[url]'; }
    });
}

export function installDiagnostics() {
  const directory = path.join(ensureUserDataDir(), 'logs');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'app.log');
  for (const level of ['info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const message = redactDiagnostic(args.map((value) => value instanceof Error ? value.stack ?? value.message : typeof value === 'string' ? value : inspect(value, { depth: 3, maxArrayLength: 20 })).join(' '));
      original(message);
      try {
        if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
          fs.rmSync(`${file}.3`, { force: true });
          for (let i = 2; i >= 1; i--) if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
          fs.renameSync(file, `${file}.1`);
        }
        fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), level, message }) + '\n', { mode: 0o600 });
      } catch { /* Diagnostics must not prevent database recovery when disk is full. */ }
    };
  }
}
