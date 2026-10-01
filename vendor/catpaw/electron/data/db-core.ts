import Database from 'better-sqlite3';
import { CATPAW_SQLITE_BUSY_TIMEOUT_ENV_KEY } from '../app-identity';
import { getDbPath } from '../runtime';
import { CURRENT_SCHEMA_VERSION, ensureDefaultOnMyMacGroups, initSchema } from './db-schema';
import { createMigrationBackup } from './migration-backup';

let db: Database.Database | null = null;
const SQLITE_BUSY_TIMEOUT_MS = (() => {
  const raw = process.env[CATPAW_SQLITE_BUSY_TIMEOUT_ENV_KEY];
  const envValue = Number(raw);
  if (raw?.trim() && Number.isFinite(envValue) && envValue >= 0) {
    return Math.floor(envValue);
  }
  // Keep the main Electron process snappy while allowing workers to opt into
  // a longer timeout via env for bulk background writes.
  return typeof process.send === 'function' ? 5000 : 200;
})();

export function getDb() {
  if (db) return db;
  const dbPath = getDbPath();
  const connection = new Database(dbPath);
  try {
    connection.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    const version = connection.pragma('user_version', { simple: true }) as number;
    if (version > CURRENT_SCHEMA_VERSION) throw new Error('DATABASE_REQUIRES_NEWER_APP');
    if (version > 0 && version < CURRENT_SCHEMA_VERSION) {
      createMigrationBackup(connection, dbPath, version);
    }
    connection.pragma('journal_mode = WAL');
    connection.pragma('foreign_keys = ON');
    initSchema(connection);
    connection.transaction(() => {
      if (version === 0) ensureDefaultOnMyMacGroups(connection);
    }).immediate();
    db = connection;
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

export function closeDb() {
  if (!db) return;
  db.close();
  db = null;
}
