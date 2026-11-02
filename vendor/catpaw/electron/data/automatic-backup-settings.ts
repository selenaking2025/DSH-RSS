import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureUserDataDir } from '../runtime';

// These are machine-local destinations and scheduling records, not reader data.
// Restoring a database must not resurrect another machine's backup destination.
export type AutomaticBackupSettings = {
  id: string;
  enabled: boolean;
  directory: string | null;
  lastSuccessAt: number | null;
  lastBackupPath: string | null;
  lastAttemptAt: number | null;
  lastError: string | null;
};
export const BACKUP_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const settingsPath = () => path.join(ensureUserDataDir(), 'automatic-backup.json');
export const defaultBackupDirectory = () => path.join(ensureUserDataDir(), 'backups', 'daily');

export function readAutomaticBackupSettings(): AutomaticBackupSettings {
  let raw: string;
  try { raw = fs.readFileSync(settingsPath(), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { id: randomUUID(), enabled: true, directory: null, lastSuccessAt: null,
      lastBackupPath: null, lastAttemptAt: null, lastError: null };
  }
  const value = JSON.parse(raw) as AutomaticBackupSettings;
  const timestamp = (v: unknown) => v === null || (Number.isSafeInteger(v) && (v as number) >= 0);
  const filePath = (v: unknown) => v === null || (typeof v === 'string' && path.isAbsolute(v) && !v.includes('\0'));
  if (!value || !BACKUP_ID_PATTERN.test(value.id) || typeof value.enabled !== 'boolean'
    || !filePath(value.directory) || !filePath(value.lastBackupPath)
    || !timestamp(value.lastSuccessAt) || !timestamp(value.lastAttemptAt)
    || !(value.lastError === null || typeof value.lastError === 'string')) throw new Error('INVALID_AUTOMATIC_BACKUP_SETTINGS');
  return value;
}

export function saveAutomaticBackupSettings(settings: AutomaticBackupSettings) {
  const destination = settingsPath();
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, destination);
  } finally { fs.rmSync(temporary, { force: true }); }
}
