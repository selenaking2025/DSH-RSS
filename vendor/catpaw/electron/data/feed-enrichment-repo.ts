import { getDb } from './db-core';
import type { FeedEnrichmentState } from './db-types';

export function listFeedEnrichmentStates(params?: {
  feedIds?: string[] | null;
}) {
  const database = getDb();
  const feedIds = (params?.feedIds ?? []).filter(Boolean);
  const placeholders = feedIds.map(() => '?').join(', ');
  const whereClause = feedIds.length > 0 ? `WHERE entries.feed_id IN (${placeholders})` : '';
  const rows = database
    .prepare(
      `SELECT
         entries.feed_id as feedId,
         COUNT(*) as totalEntries,
         SUM(CASE WHEN entries.link IS NOT NULL AND LENGTH(COALESCE(entries.content_text, entries.content_html, '')) < 400 AND entries.content_fetch_status IS NULL THEN 1 ELSE 0 END) as pendingEntries,
         SUM(CASE WHEN entries.content_fetch_status = 'fetching' THEN 1 ELSE 0 END) as fetchingEntries,
         SUM(CASE WHEN entries.content_fetch_status = 'fetched' THEN 1 ELSE 0 END) as fetchedEntries,
         SUM(CASE WHEN entries.content_fetch_status = 'no_content' THEN 1 ELSE 0 END) as noContentEntries,
         SUM(CASE WHEN entries.content_fetch_status = 'failed' THEN 1 ELSE 0 END) as failedEntries,
         SUM(CASE WHEN entries.content_fetch_status = 'auth_required' THEN 1 ELSE 0 END) as authRequiredEntries,
         SUM(CASE WHEN entries.media_type IN ('audio', 'video') AND (entries.media_url IS NULL OR TRIM(entries.media_url) = '') THEN 1 ELSE 0 END) as mediaPendingEntries,
         MAX(entries.content_fetch_attempted_at) as lastAttemptedAt,
         MAX(entries.content_fetched_at) as lastFetchedAt
       FROM entries
       ${whereClause}
       GROUP BY entries.feed_id`,
    )
    .all(...feedIds) as Array<Omit<FeedEnrichmentState, 'state' | 'enrichableEntries'>>;

  return rows.map((row) => {
    const enrichableEntries = row.pendingEntries + row.fetchingEntries + row.failedEntries + row.authRequiredEntries + row.mediaPendingEntries;
    let state: FeedEnrichmentState['state'] = 'healthy';
    if (row.failedEntries > 0 || row.authRequiredEntries > 0) {
      state = 'attention';
    } else if (enrichableEntries > 0) {
      state = 'pending';
    } else if (row.fetchedEntries === 0 && row.noContentEntries === 0) {
      state = 'idle';
    }

    return {
      ...row,
      enrichableEntries,
      state,
    };
  }) satisfies FeedEnrichmentState[];
}
