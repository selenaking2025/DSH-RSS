import { getDb } from './db-core';

export function getFeedUnreadCounts(): Array<{ feedId: string; count: number }> {
  const database = getDb();
  return database
    .prepare('SELECT feed_id as feedId, COUNT(*) as count FROM entries WHERE is_read = 0 GROUP BY feed_id')
    .all() as Array<{ feedId: string; count: number }>;
}

export function countEntries(params?: {
  feedId?: string | null;
  createdAfter?: number | null;
  createdBefore?: number | null;
  onlyStarred?: boolean;
  onlyUnread?: boolean;
  sincePublishedAt?: number | null;
}) {
  const database = getDb();
  const conditions: string[] = [];
  const values: Array<string | number> = [];

  if (params?.feedId) {
    conditions.push('feed_id = ?');
    values.push(params.feedId);
  }
  if (params?.createdAfter !== undefined && params?.createdAfter !== null) {
    conditions.push('created_at >= ?');
    values.push(params.createdAfter);
  }
  if (params?.createdBefore !== undefined && params?.createdBefore !== null) {
    conditions.push('created_at < ?');
    values.push(params.createdBefore);
  }
  if (params?.onlyStarred) {
    conditions.push('is_starred = 1');
  }
  if (params?.onlyUnread) {
    conditions.push('is_read = 0');
  }
  if (params?.sincePublishedAt !== undefined && params?.sincePublishedAt !== null) {
    conditions.push('COALESCE(published_at, created_at) >= ?');
    values.push(params.sincePublishedAt);
  }

  const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const row = database.prepare(`SELECT COUNT(*) as count FROM entries${whereClause}`).get(values) as { count: number } | undefined;
  return row?.count ?? 0;
}
