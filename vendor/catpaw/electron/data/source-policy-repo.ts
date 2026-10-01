import type Database from 'better-sqlite3';
import { inferSourceStrategy, type SourceIdentity, type SourceStrategy } from '../sources/source-policy';

export function readSourceStrategy(database: Database.Database, feed: SourceIdentity & { id: string }): SourceStrategy {
  const saved = database.prepare(`SELECT strategy FROM feed_source_policies
    WHERE feed_id = ? AND source_url = ? AND site_url IS ?`).get(feed.id, feed.url, feed.siteUrl) as { strategy: SourceStrategy } | undefined;
  return saved?.strategy ?? inferSourceStrategy(feed);
}

export function saveSourceStrategy(database: Database.Database, feed: SourceIdentity & { id: string; sourceStrategy: SourceStrategy }) {
  database.prepare(`INSERT INTO feed_source_policies (feed_id, source_url, site_url, strategy) VALUES (?, ?, ?, ?)
    ON CONFLICT(feed_id) DO UPDATE SET source_url = excluded.source_url, site_url = excluded.site_url, strategy = excluded.strategy`)
    .run(feed.id, feed.url, feed.siteUrl, feed.sourceStrategy);
}
