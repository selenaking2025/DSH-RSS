import { randomUUID } from 'node:crypto';
import { getDb } from './db-core';
import { syncSourceEndpointRecordsForFeed } from './source-endpoint-repo';
import { getFeedSyncTarget, writeFeedSync, type FeedSyncTarget } from './feed-sync-repo';

function extractXiaoyuzhouPodcastIdFromMirrorUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'feed.xyzfm.space') return null;
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const match = pathname.match(/^([A-Za-z0-9]{12,64})\.xml$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function upsertFeed(input: {
  title?: string | null;
  url: string;
  siteUrl?: string | null;
  groupId?: string | null;
  sourceType?: string | null;
}) {
  const database = getDb();
  const existing = database.prepare('SELECT id, group_id as groupId FROM feeds WHERE url = ?').get(input.url) as { id: string; groupId: string | null } | undefined;
  if (existing) {
    const nextGroupId = input.groupId === undefined ? existing.groupId : input.groupId ?? null;
    database
      .prepare('UPDATE feeds SET title = ?, site_url = ?, group_id = ?, source_type = COALESCE(?, source_type) WHERE id = ?')
      .run(input.title ?? null, input.siteUrl ?? null, nextGroupId, input.sourceType ?? null, existing.id);
    syncSourceEndpointRecordsForFeed(existing.id);
    return existing.id;
  }
  const id = randomUUID();
  database
    .prepare('INSERT INTO feeds (id, title, url, site_url, group_id, source_type) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, input.title ?? null, input.url, input.siteUrl ?? null, input.groupId ?? null, input.sourceType ?? null);
  syncSourceEndpointRecordsForFeed(id);
  return id;
}

export function getFeedFetchMetaByUrl(url: string): {
  id: string;
  url: string;
  syncRevision: number;
  fetchMetaUrl: string | null;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  conditionalGetAt: number | null;
  historySyncedAt: number | null;
} | null {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT id, url, sync_revision as syncRevision, fetch_meta_url as fetchMetaUrl, etag, last_modified as lastModified, content_hash as contentHash,
              conditional_get_at as conditionalGetAt, history_synced_at as historySyncedAt
       FROM feeds
       WHERE url = ?`,
    )
    .get(url) as {
    id: string;
    url: string;
    syncRevision: number;
    fetchMetaUrl: string | null;
    etag: string | null;
    lastModified: string | null;
    contentHash: string | null;
    conditionalGetAt: number | null;
    historySyncedAt: number | null;
  } | undefined;
  return row ?? null;
}

/** Refresh may create a new subscription only when it started without an existing one.
 * Existing subscriptions retain all user-owned settings, including title and folder. */
export function resolveFeedForSync(input: Parameters<typeof upsertFeed>[0], target?: FeedSyncTarget): FeedSyncTarget {
  return writeFeedSync(target, target?.id ?? '', () => {
    if (target) return target;
    const existing = getFeedFetchMetaByUrl(input.url);
    return getFeedSyncTarget(existing?.id ?? upsertFeed(input));
  });
}

export function cleanupEmptyXiaoyuzhouMirrorFeeds() {
  const database = getDb();
  const emptyFeeds = database
    .prepare(
      `SELECT f.id as id, f.url as url
       FROM feeds f
       LEFT JOIN entries e ON e.feed_id = f.id
       GROUP BY f.id
       HAVING COUNT(e.id) = 0`,
    )
    .all() as Array<{ id: string; url: string }>;

  const hasSiblingWithEntries = database.prepare(
    `SELECT 1
     FROM feeds f
     JOIN entries e ON e.feed_id = f.id
     WHERE f.id != ? AND (f.url LIKE ? OR f.site_url LIKE ?)
     LIMIT 1`,
  );
  const deleteFeedStatement = database.prepare('DELETE FROM feeds WHERE id = ?');

  const deletedIds: string[] = [];
  const run = database.transaction(() => {
    for (const feed of emptyFeeds) {
      const podcastId = extractXiaoyuzhouPodcastIdFromMirrorUrl(feed.url);
      if (!podcastId) continue;
      const pattern = `%${podcastId}%`;
      const sibling = hasSiblingWithEntries.get(feed.id, pattern, pattern) as { 1: number } | undefined;
      if (!sibling) continue;
      deleteFeedStatement.run(feed.id);
      deletedIds.push(feed.id);
    }
  });
  run();

  return { deleted: deletedIds.length, ids: deletedIds };
}

export function listFeedEntryLinks(feedId: string, limit = 30): string[] {
  const database = getDb();
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const rows = database
    .prepare(
      `SELECT link
       FROM entries
       WHERE feed_id = ? AND link IS NOT NULL
       ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC
       LIMIT ?`,
    )
    .all(feedId, safeLimit) as Array<{ link: string | null }>;
  return rows.map((row) => row.link).filter((link): link is string => Boolean(link));
}

export function updateFeed(
  id: string,
  input: {
    title?: string | null;
    url?: string;
    siteUrl?: string | null;
    groupId?: string | null;
    confirmUrlChange?: boolean;
    enabled?: boolean;
    fetchIntervalMinutes?: number | null;
  },
) {
  const database = getDb();
  const existing = database
    .prepare(
      `SELECT id, url, title, site_url as siteUrl, group_id as groupId, enabled,
              fetch_interval_minutes as fetchIntervalMinutes, next_refresh_at as nextRefreshAt
       FROM feeds WHERE id = ?`,
    )
    .get(id) as {
      id: string;
      url: string;
      title: string | null;
      siteUrl: string | null;
      groupId: string | null;
      enabled: number;
      fetchIntervalMinutes: number | null;
      nextRefreshAt: number | null;
    } | undefined;
  if (!existing) {
    return { ok: false, error: 'FEED_NOT_FOUND' as const };
  }

  const nextTitle = input.title === undefined ? existing.title : input.title ?? null;
  const nextUrl = input.url?.trim() || existing.url;
  const nextSiteUrl = input.siteUrl === undefined ? existing.siteUrl : input.siteUrl ?? null;
  const nextGroupId = input.groupId === undefined ? existing.groupId : input.groupId ?? null;
  const nextEnabled = input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0;
  const requestedInterval = input.fetchIntervalMinutes === undefined
    ? existing.fetchIntervalMinutes
    : input.fetchIntervalMinutes;
  if (requestedInterval !== null && !Number.isFinite(requestedInterval)) {
    return { ok: false, error: 'FEED_INTERVAL_INVALID' as const };
  }
  const nextFetchIntervalMinutes = requestedInterval === null
    ? null
    : Math.max(5, Math.min(7 * 24 * 60, Math.floor(requestedInterval)));
  const scheduleChanged = nextEnabled !== existing.enabled || nextFetchIntervalMinutes !== existing.fetchIntervalMinutes;
  const nextRefreshAt = nextEnabled === 0 || nextFetchIntervalMinutes === null
    ? null
    : scheduleChanged || existing.nextRefreshAt === null
      ? Date.now() + nextFetchIntervalMinutes * 60_000
      : existing.nextRefreshAt;
  const urlChanged = nextUrl !== existing.url;

  if (urlChanged && input.confirmUrlChange !== true) {
    return { ok: false, error: 'URL_CHANGE_CONFIRMATION_REQUIRED' as const, urlChanged: true };
  }

  try {
    const transaction = database.transaction(() => {
      if (urlChanged) {
        const entryRows = database.prepare('SELECT id FROM entries WHERE feed_id = ?').all(id) as Array<{ id: string }>;
        const deleteFts = database.prepare('DELETE FROM entries_fts WHERE entry_id = ?');
        for (const entry of entryRows) {
          deleteFts.run(entry.id);
        }
        database.prepare('DELETE FROM entries WHERE feed_id = ?').run(id);
        database
          .prepare(
            `UPDATE feeds
             SET last_checked_at = NULL, last_modified = NULL, etag = NULL, content_hash = NULL,
                 conditional_get_at = NULL, fetch_meta_url = NULL, history_synced_at = NULL
             WHERE id = ?`,
          )
          .run(id);
      }
      database
        .prepare(
          `UPDATE feeds
           SET title = ?, url = ?, site_url = ?, group_id = ?, enabled = ?,
               fetch_interval_minutes = ?, next_refresh_at = ?
           WHERE id = ?`,
        )
        .run(
          nextTitle ?? null,
          nextUrl,
          nextSiteUrl ?? null,
          nextGroupId ?? null,
          nextEnabled,
          nextFetchIntervalMinutes,
          nextRefreshAt,
          id,
        );
      syncSourceEndpointRecordsForFeed(id);
    });
    transaction();
    return { ok: true, urlChanged };
  } catch (error) {
    if (error instanceof Error && /UNIQUE/.test(error.message)) {
      return { ok: false, error: 'URL_EXISTS' as const };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function deleteFeed(id: string) {
  const database = getDb();
  try {
    const entryRows = database.prepare('SELECT id FROM entries WHERE feed_id = ?').all(id) as Array<{ id: string }>;
    const transaction = database.transaction(() => {
      const deleteFts = database.prepare('DELETE FROM entries_fts WHERE entry_id = ?');
      for (const entry of entryRows) {
        deleteFts.run(entry.id);
      }
      database.prepare('DELETE FROM feeds WHERE id = ?').run(id);
    });
    transaction();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function updateFeedFetchMeta(
  id: string,
  meta: {
    lastCheckedAt?: number;
    lastModified?: string | null;
    etag?: string | null;
    contentHash?: string | null;
    conditionalGetAt?: number | null;
    fetchMetaUrl?: string | null;
  },
  syncTarget?: FeedSyncTarget,
) {
  // Only touch the columns the caller actually supplied. Adapter refreshes
  // (html-article-listing, wechat-native-listing, x-api-twitter, web-cli-twitter)
  // pass just lastCheckedAt; overwriting the rest with NULL used to wipe the
  // conditional-GET state their RSS fallback endpoint depends on. Passing an
  // explicit null still clears a column.
  const columnsByKey = {
    lastCheckedAt: 'last_checked_at',
    lastModified: 'last_modified',
    etag: 'etag',
    contentHash: 'content_hash',
    conditionalGetAt: 'conditional_get_at',
    fetchMetaUrl: 'fetch_meta_url',
  } as const;

  const assignments: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, column] of Object.entries(columnsByKey) as Array<[keyof typeof columnsByKey, string]>) {
    const value = meta[key];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(value);
  }

  if (assignments.length === 0) return;

  writeFeedSync(syncTarget, id, () => getDb()
    .prepare(`UPDATE feeds SET ${assignments.join(', ')} WHERE id = ?`)
    .run(...values, id));
}

export function updateFeedHistorySyncedAt(id: string, historySyncedAt: number | null, syncTarget?: FeedSyncTarget) {
  const database = getDb();
  writeFeedSync(syncTarget, id, () => database.prepare('UPDATE feeds SET history_synced_at = ? WHERE id = ?').run(historySyncedAt ?? null, id));
}

export function pruneEntriesForFeed(feedId: string, keepIds: string[]) {
  if (keepIds.length === 0) return { pruned: 0 };
  const database = getDb();

  database.exec('CREATE TEMP TABLE IF NOT EXISTS feed_refresh_keep (id TEXT PRIMARY KEY)');
  const clearTemp = database.prepare('DELETE FROM feed_refresh_keep');
  const insertTemp = database.prepare('INSERT OR IGNORE INTO feed_refresh_keep (id) VALUES (?)');

  const seedTemp = database.transaction((ids: string[]) => {
    clearTemp.run();
    for (const id of ids) {
      insertTemp.run(id);
    }
  });
  seedTemp(keepIds);

  const rows = database
    .prepare(
      `SELECT id FROM entries
       WHERE feed_id = ? AND is_starred = 0 AND id NOT IN (SELECT id FROM feed_refresh_keep)`,
    )
    .all(feedId) as Array<{ id: string }>;

  if (rows.length === 0) return { pruned: 0 };

  const deleteFts = database.prepare('DELETE FROM entries_fts WHERE entry_id = ?');
  const deleteEntry = database.prepare('DELETE FROM entries WHERE id = ?');
  const prune = database.transaction(() => {
    for (const row of rows) {
      deleteFts.run(row.id);
      deleteEntry.run(row.id);
    }
  });
  prune();
  return { pruned: rows.length };
}

export function updateFeedContentType(id: string, contentType: string, syncTarget?: FeedSyncTarget) {
  const database = getDb();
  writeFeedSync(syncTarget, id, () => {
    database.prepare('UPDATE feeds SET content_type = ? WHERE id = ?').run(contentType, id);
    syncSourceEndpointRecordsForFeed(id);
  });
}

export function updateFeedSourceType(id: string, sourceType: string, syncTarget?: FeedSyncTarget) {
  const database = getDb();
  writeFeedSync(syncTarget, id, () => {
    database.prepare('UPDATE feeds SET source_type = ? WHERE id = ?').run(sourceType, id);
    syncSourceEndpointRecordsForFeed(id);
  });
}
