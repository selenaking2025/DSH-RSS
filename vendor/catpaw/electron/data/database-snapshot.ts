import Database from 'better-sqlite3';
import { CURRENT_SCHEMA_VERSION } from './db-schema';

export const CATPAW_DATABASE_ID = 0x43505731;

export function makeStandaloneSnapshot(filePath: string) {
  const snapshot = new Database(filePath, { fileMustExist: true });
  try { snapshot.pragma('journal_mode = DELETE'); } finally { snapshot.close(); }
}

export function validateDatabaseBackup(filePath: string) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    if (database.pragma('application_id', { simple: true }) !== CATPAW_DATABASE_ID) throw new Error('NOT_A_CATPAW_BACKUP');
    const version = Number(database.pragma('user_version', { simple: true }));
    if (version < 1 || version > CURRENT_SCHEMA_VERSION) throw new Error('BACKUP_REQUIRES_NEWER_APP');
    if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('BACKUP_INTEGRITY_FAILED');
    if ((database.pragma('foreign_key_check') as unknown[]).length) throw new Error('BACKUP_RELATIONS_INVALID');
    const feeds = database.prepare('SELECT COUNT(*) AS count FROM feeds').get() as { count: number };
    const entries = database.prepare('SELECT COUNT(*) AS count FROM entries').get() as { count: number };
    return { version, feeds: feeds.count, entries: entries.count };
  } finally { database.close(); }
}
