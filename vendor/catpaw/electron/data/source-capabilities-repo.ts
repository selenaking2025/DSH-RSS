import type Database from 'better-sqlite3';
import type { SourceCapabilities } from '../contracts/source-capabilities';

const KEY = 'rss.capability.web_cli_twitter';

/** A shared snapshot: readers and workers never discover external tools while writing. */
export function readSourceCapabilities(database: Database.Database): SourceCapabilities {
  const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  return { webCliTwitter: row?.value === '1' };
}

export function saveSourceCapabilities(database: Database.Database, capabilities: SourceCapabilities) {
  database.prepare(`INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(KEY, capabilities.webCliTwitter ? '1' : '0', Date.now());
}
