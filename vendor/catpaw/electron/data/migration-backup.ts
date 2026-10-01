import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CATPAW_DATABASE_ID, validateDatabaseBackup } from './database-snapshot';

const RETAINED_MIGRATION_BACKUPS = 1;
const MIGRATION_BACKUP_NAME = /^before-schema-([1-9]\d*)-(\d+)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.sqlite3$/;
const SQLITE_SUFFIXES = ['', '-journal', '-wal', '-shm'];

function removeIncompleteSnapshot(temporary: string) {
  for (const suffix of SQLITE_SUFFIXES) {
    try { fs.rmSync(temporary + suffix, { force: true }); }
    catch (error) { console.warn('[database] Could not remove incomplete migration backup', temporary + suffix, error); }
  }
}

function pruneMigrationBackups(directory: string, newest: string) {
  const candidates = fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const match = entry.isFile() ? MIGRATION_BACKUP_NAME.exec(entry.name) : null;
    if (!match) return [];
    return [{ filePath: path.join(directory, entry.name), version: Number(match[1]), createdAt: Number(match[2]) }];
  }).filter((candidate) => candidate.filePath !== newest)
    .sort((a, b) => b.createdAt - a.createdAt || b.filePath.localeCompare(a.filePath));
  if (candidates.length < RETAINED_MIGRATION_BACKUPS) return;

  // The newly published backup has already passed validation. Do not let corrupt,
  // foreign or newer-format files displace a usable recovery point.
  let retained = 1;
  for (const candidate of candidates) {
    try {
      if (SQLITE_SUFFIXES.slice(1).some((suffix) => fs.existsSync(candidate.filePath + suffix))) continue;
      const summary = validateDatabaseBackup(candidate.filePath);
      if (summary.version !== candidate.version) continue;
      if (retained < RETAINED_MIGRATION_BACKUPS) { retained += 1; continue; }
      fs.unlinkSync(candidate.filePath);
    } catch (error) {
      // An unreadable backup is not proof that it is disposable. Failed cleanup
      // must also never stop startup after a verified new backup was saved.
      console.warn('[database] Preserving migration backup that could not be validated or removed', candidate.filePath, error);
    }
  }
}

export function createMigrationBackup(database: Database.Database, databasePath: string, version: number) {
  const directory = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, `before-schema-${version}-${Date.now()}-${randomUUID()}.sqlite3`);
  const temporary = `${destination}.tmp`;
  // Reserve an empty file exclusively; VACUUM INTO accepts an empty destination.
  fs.closeSync(fs.openSync(temporary, 'wx', 0o600));
  try {
    database.prepare('VACUUM INTO ?').run(temporary);
    const snapshot = new Database(temporary, { fileMustExist: true });
    try {
      snapshot.pragma('journal_mode = DELETE');
      snapshot.pragma(`application_id = ${CATPAW_DATABASE_ID}`);
    } finally { snapshot.close(); }
    if (validateDatabaseBackup(temporary).version !== version) throw new Error('MIGRATION_BACKUP_VERSION_MISMATCH');
    fs.renameSync(temporary, destination);
  } finally { removeIncompleteSnapshot(temporary); }

  try { pruneMigrationBackups(directory, destination); }
  catch (error) { console.warn('[database] Could not prune old migration backups', error); }
  return destination;
}
