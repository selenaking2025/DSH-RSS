import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { getDb, closeDb } from './db-core';
import { makeStandaloneSnapshot, validateDatabaseBackup } from './database-snapshot';
import { ensureUserDataDir, getDbPath } from '../runtime';

export { CATPAW_DATABASE_ID, validateDatabaseBackup } from './database-snapshot';
const pendingPath = () => path.join(ensureUserDataDir(), 'pending-restore.json');

export async function backupDatabase(destination: string) {
  if (path.resolve(destination) === path.resolve(getDbPath())) throw new Error('BACKUP_CANNOT_OVERWRITE_ACTIVE_DATABASE');
  // A failed export never leaves a partial file under the user-selected name.
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await getDb().backup(temporary);
    makeStandaloneSnapshot(temporary);
    const summary = validateDatabaseBackup(temporary);
    fs.renameSync(temporary, destination);
    return { ok: true as const, filePath: destination, ...summary };
  } finally { for (const suffix of ['', '-wal', '-shm']) fs.rmSync(temporary + suffix, { force: true }); }
}

async function checksum(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function prepareDatabaseRestore(source: string, mode: 'normal' | 'unreadable' = 'normal') {
  validateDatabaseBackup(source);
  const directory = path.join(ensureUserDataDir(), 'backups');
  fs.mkdirSync(directory, { recursive: true });
  const name = `restore-${randomUUID()}.sqlite3`;
  const staged = path.join(directory, name);
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try { await database.backup(staged); } finally { database.close(); }
  try {
    makeStandaloneSnapshot(staged);
    const summary = validateDatabaseBackup(staged);
    let rollback: string;
    if (mode === 'normal') {
      rollback = path.join(directory, `before-restore-${Date.now()}-${randomUUID()}.sqlite3`);
      await backupDatabase(rollback);
    } else {
      closeDb();
      rollback = path.join(directory, `unreadable-${Date.now()}-${randomUUID()}`);
      fs.mkdirSync(rollback, { mode: 0o700 });
      for (const suffix of ['', '-wal', '-shm']) {
        const original = getDbPath() + suffix;
        if (fs.existsSync(original)) fs.copyFileSync(original, path.join(rollback, path.basename(original)));
      }
    }
    const pending = { name, checksum: await checksum(staged), rollback, recovery: mode === 'unreadable' };
    const temporary = `${pendingPath()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(pending), { mode: 0o600 });
    fs.renameSync(temporary, pendingPath());
    return { ok: true as const, rollback, ...summary };
  } catch (error) { fs.rmSync(staged, { force: true }); throw error; }
}

/** Called once, after the app's instance lock and before opening repositories/workers. */
export async function applyPendingDatabaseRestore() {
  if (!fs.existsSync(pendingPath())) return false;
  const pending = JSON.parse(fs.readFileSync(pendingPath(), 'utf8')) as { name: string; checksum: string; recovery?: boolean };
  if (!/^restore-[a-f0-9-]+\.sqlite3$/.test(pending.name)) throw new Error('RESTORE_JOURNAL_INVALID');
  const staged = path.join(ensureUserDataDir(), 'backups', pending.name);
  const destination = getDbPath();
  if (!fs.existsSync(staged)) {
    // A previous process may have ended between the atomic replacement and journal removal.
    if (await checksum(destination) !== pending.checksum) throw new Error('RESTORE_JOURNAL_INCOMPLETE');
    fs.rmSync(pendingPath()); return true;
  }
  if (await checksum(staged) !== pending.checksum) throw new Error('RESTORE_BACKUP_CHANGED');
  validateDatabaseBackup(staged);
  closeDb();
  if (fs.existsSync(destination) && !pending.recovery) {
    const current = new Database(destination);
    try { current.pragma('wal_checkpoint(TRUNCATE)'); } finally { current.close(); }
  }
  for (const suffix of ['-wal', '-shm']) fs.rmSync(destination + suffix, { force: true });
  fs.renameSync(staged, destination);
  fs.rmSync(pendingPath());
  return true;
}
