import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export type ResolvedWebCliCommand = { command: string; argsPrefix: string[] };
let discovery: Promise<ResolvedWebCliCommand | null> | undefined;
export function resetWebCliCommandCache() { discovery = undefined; }

async function accessible(file: string, mode: number) {
  try { await fs.access(file, mode); return (await fs.stat(file)).isFile(); }
  catch { return false; }
}

async function discoverCommand(): Promise<ResolvedWebCliCommand | null> {
  const configured = process.env.CATPAW_WEB_CLI_BIN?.trim();
  if (configured) return configured.endsWith('.js')
    ? { command: process.execPath, argsPrefix: [configured] } : { command: configured, argsPrefix: [] };
  const sibling = path.resolve(process.cwd(), '../web-cli/cli.js');
  if (await accessible(sibling, constants.R_OK)) return { command: process.execPath, argsPrefix: [sibling] };
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const command = path.join(directory, process.platform === 'win32' ? 'web-cli.exe' : 'web-cli');
    if (await accessible(command, constants.X_OK)) return { command, argsPrefix: [] };
  }
  return null;
}

/** Discover an executable without running it. Even an unusual network PATH is bounded. */
export function resolveWebCliCommand() {
  return discovery ??= new Promise<ResolvedWebCliCommand | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 1500);
    void discoverCommand().then(resolve, () => resolve(null)).finally(() => clearTimeout(timeout));
  });
}
