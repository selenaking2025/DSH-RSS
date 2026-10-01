import { measureTransaction } from '../diagnostics/performance';
import type Database from 'better-sqlite3';
import { getDb } from './db-core';

/** The identity of the source being fetched, captured before any network wait. */
export type FeedSyncTarget = { id: string; url: string; revision: number };

export function getFeedSyncTarget(id: string): FeedSyncTarget {
  const target = getDb().prepare('SELECT id, url, sync_revision AS revision FROM feeds WHERE id = ?').get(id) as FeedSyncTarget | undefined;
  if (!target) throw new Error('FEED_NOT_FOUND');
  return target;
}

export function assertFeedSyncTarget(database: Database.Database, target: FeedSyncTarget, feedId = target.id) {
  if (feedId !== target.id || !database.prepare('SELECT 1 FROM feeds WHERE id = ? AND url = ? AND sync_revision = ?')
    .get(target.id, target.url, target.revision)) throw new Error('FEED_CHANGED_DURING_SYNC');
}

export function checkFeedSyncTarget(target: FeedSyncTarget) {
  assertFeedSyncTarget(getDb(), target);
}

/** Keep the identity check and the write under the same SQLite write lock. */
export function writeFeedSync<T>(target: FeedSyncTarget | undefined, feedId: string, write: () => T): T {
  const database = getDb();
  return measureTransaction(() => database.transaction(() => {
    if (target) assertFeedSyncTarget(database, target, feedId);
    return write();
  }).immediate());
}
