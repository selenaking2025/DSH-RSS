import { measureTransaction } from '../diagnostics/performance';
import { createHash, randomUUID } from 'node:crypto';
import { getDb } from './db-core';
import type { Entry, EntryListItem, EntryCursor } from '../contracts/reader';
export type { EntryCursor } from '../contracts/reader';
import { assertFeedSyncTarget, type FeedSyncTarget } from './feed-sync-repo';

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function coerceTextValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = coerceTextValue(item);
      if (normalized) return normalized;
    }
    return null;
  }
  if (typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const candidates = [
    record.name,
    record.title,
    record.label,
    record.value,
    record._,
    record['#text'],
    record.url,
  ];
  for (const candidate of candidates) {
    const normalized = coerceTextValue(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function createFingerprint(input: {
  title?: string | null;
  publishedAt?: number | null;
  summary?: string | null;
  contentText?: string | null;
}) {
  const parts = [
    input.title ?? '',
    input.publishedAt ? String(input.publishedAt) : '',
    input.summary ?? '',
    input.contentText ?? '',
  ];
  if (parts.every((part) => !part)) return null;
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function updateEntryFts(entryId: string, title: string | null, summary: string | null, contentText: string | null) {
  const database = getDb();
  database.prepare('DELETE FROM entries_fts WHERE rowid = (SELECT rowid FROM entries WHERE id = ?)').run(entryId);
  database
    .prepare('INSERT INTO entries_fts (rowid, entry_id, title, summary, content_text) SELECT rowid, id, ?, ?, ? FROM entries WHERE id = ?')
    .run(title ?? '', summary ?? '', contentText ?? '', entryId);
}

export function upsertEntry(input: {
  feedId: string;
  syncTarget?: FeedSyncTarget;
  guid?: string | null;
  title?: string | null;
  link?: string | null;
  author?: string | null;
  publishedAt?: number | null;
  summary?: string | null;
  contentHtml?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
}) {
  const database = getDb();
  return measureTransaction(() => database.transaction(() => {
  if (input.syncTarget) assertFeedSyncTarget(database, input.syncTarget, input.feedId);
  const guid = coerceTextValue(input.guid);
  const title = coerceTextValue(input.title);
  const link = coerceTextValue(input.link);
  const author = coerceTextValue(input.author);
  const contentHtml = coerceTextValue(input.contentHtml);
  const mediaUrl = coerceTextValue(input.mediaUrl);
  const mediaType = coerceTextValue(input.mediaType);

  const contentText = contentHtml ? stripHtml(contentHtml) : null;
  const normalizedSummary = coerceTextValue(input.summary);
  const summarySource = normalizedSummary ? stripHtml(normalizedSummary) : null;
  const summaryText = summarySource ?? (contentText ? contentText.slice(0, 280) : null);
  const fingerprint = createFingerprint({
    title,
    publishedAt: input.publishedAt ?? null,
    summary: summaryText,
    contentText,
  });

  type ExistingEntryRow = {
    id: string;
    guid: string | null;
    link: string | null;
    fingerprint: string | null;
    isRead: number;
    isStarred: number;
    title: string | null;
    author: string | null;
    publishedAt: number | null;
    summary: string | null;
    contentHtml: string | null;
    contentText: string | null;
  };

  const selectBase = `SELECT id, guid, link, fingerprint, is_read as isRead, is_starred as isStarred,
                             title, author, published_at as publishedAt,
                             summary, content_html as contentHtml, content_text as contentText
                      FROM entries`;
  const byLink = link
    ? (database.prepare(`${selectBase} WHERE feed_id = ? AND link = ?`).get(input.feedId, link) as ExistingEntryRow | undefined)
    : undefined;
  const byGuid = guid
    ? (database.prepare(`${selectBase} WHERE feed_id = ? AND guid = ?`).get(input.feedId, guid) as ExistingEntryRow | undefined)
    : undefined;
  const byFingerprint = fingerprint
    ? (database.prepare(`${selectBase} WHERE feed_id = ? AND fingerprint = ?`).get(input.feedId, fingerprint) as ExistingEntryRow | undefined)
    : undefined;

  let existing: ExistingEntryRow | undefined;
  let unstableGuid = false;
  let unstableLink = false;

  if (byLink && byGuid && byLink.id !== byGuid.id) {
    unstableGuid = Boolean(guid);
    unstableLink = Boolean(link);
  }

  if (byLink && !unstableLink) {
    if (guid && byLink.guid && byLink.guid !== guid) {
      unstableLink = true;
    } else {
      existing = byLink;
    }
  }

  if (!existing && byGuid && !unstableGuid) {
    if (link && byGuid.link && byGuid.link !== link) {
      unstableGuid = true;
    } else if (byLink && byLink.id !== byGuid.id) {
      unstableGuid = true;
    } else {
      existing = byGuid;
    }
  }

  if (!existing && byFingerprint && !unstableGuid && !unstableLink) {
    const guidCompatible = !guid || !byFingerprint.guid || byFingerprint.guid === guid;
    const linkCompatible = !link || !byFingerprint.link || byFingerprint.link === link;
    if (guidCompatible && linkCompatible) {
      existing = byFingerprint;
    }
  }

  if (existing) {
    // A sparser mirror (common during history backfill, which deliberately walks
    // several endpoints for the same item) must never erase fields the richer
    // source already stored. Non-null incoming values still win, so genuine
    // corrections continue to apply.
    const mergedTitle = title ?? existing.title ?? null;
    const mergedAuthor = author ?? existing.author ?? null;
    const mergedPublishedAt = input.publishedAt ?? existing.publishedAt ?? null;
    let mergedSummary = summaryText ?? existing.summary ?? null;
    let mergedContentHtml = contentHtml ?? existing.contentHtml ?? null;
    let mergedContentText = contentText ?? existing.contentText ?? null;

    if (existing.contentText && contentText) {
      const shouldKeepExistingLongContent = existing.contentText.length >= 400 && contentText.length < existing.contentText.length * 0.6;
      if (shouldKeepExistingLongContent) {
        mergedContentHtml = existing.contentHtml ?? mergedContentHtml;
        mergedContentText = existing.contentText;
        if ((existing.summary ?? '').length > (summaryText ?? '').length) {
          mergedSummary = existing.summary;
        }
      }
    }

    database
      .prepare(
        `UPDATE entries
         SET title = ?, guid = COALESCE(guid, ?), link = COALESCE(link, ?), author = ?, published_at = ?, summary = ?, content_html = ?, content_text = ?,
             fingerprint = COALESCE(fingerprint, ?),
             media_url = COALESCE(?, media_url), media_type = COALESCE(?, media_type)
         WHERE id = ?`,
      )
      .run(
        mergedTitle,
        guid,
        link,
        mergedAuthor,
        mergedPublishedAt,
        mergedSummary,
        mergedContentHtml,
        mergedContentText,
        fingerprint,
        mediaUrl,
        mediaType,
        existing.id,
      );
    updateEntryFts(existing.id, mergedTitle, mergedSummary, mergedContentText);
    return existing.id;
  }

  if (unstableGuid || unstableLink) {
    console.warn('[rss] entry identity conflict detected; inserting with downgraded keys', {
      feedId: input.feedId,
      guid,
      link,
      byGuidId: byGuid?.id ?? null,
      byLinkId: byLink?.id ?? null,
      unstableGuid,
      unstableLink,
    });
  }

  const insertStatement = database.prepare(
    `INSERT INTO entries
     (id, feed_id, guid, title, link, author, published_at, summary, content_html, content_text, fingerprint, media_url, media_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let insertGuid = unstableGuid ? null : guid;
  let insertLink = unstableLink ? null : link;
  let insertFingerprint = unstableGuid || unstableLink ? null : fingerprint;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const id = randomUUID();
    const createdAt = Date.now();
    try {
      insertStatement.run(
        id,
        input.feedId,
        insertGuid,
        title,
        insertLink,
        author,
        input.publishedAt ?? null,
        summaryText,
        contentHtml,
        contentText,
        insertFingerprint,
        mediaUrl,
        mediaType,
        createdAt,
      );
      updateEntryFts(id, title, summaryText, contentText);
      return id;
    } catch (error) {
      if (!(error instanceof Error) || !/UNIQUE constraint failed: entries\.feed_id, entries\.(guid|link|fingerprint)/i.test(error.message)) {
        throw error;
      }

      const message = error.message;
      const guidConflict = /entries\.feed_id,\s*entries?\.guid/i.test(message);
      const linkConflict = /entries\.feed_id,\s*entries?\.link/i.test(message);
      const fingerprintConflict = /entries\.feed_id,\s*entries?\.fingerprint/i.test(message);
      let changed = false;

      if (guidConflict && insertGuid !== null) {
        insertGuid = null;
        changed = true;
      }
      if (linkConflict && insertLink !== null) {
        insertLink = null;
        changed = true;
      }
      if (fingerprintConflict && insertFingerprint !== null) {
        insertFingerprint = null;
        changed = true;
      }

      if ((guidConflict || linkConflict) && insertFingerprint !== null) {
        insertFingerprint = null;
        changed = true;
      }

      if (!changed && (insertGuid !== null || insertLink !== null || insertFingerprint !== null)) {
        insertGuid = null;
        insertLink = null;
        insertFingerprint = null;
        changed = true;
      }

      if (!changed) throw error;
    }
  }

  throw new Error('ENTRY_INSERT_RETRY_EXHAUSTED');
  }).immediate());
}


/** Treat search as ordinary text. Quotes and FTS operators are never executable syntax. */
export function plainTextSearch(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).map((word) => '"' + word.replace(/"/g, '""') + '"').join(' AND ');
}

export type ListEntriesParams = {
  cursor?: EntryCursor | null;
  feedId?: string | null;
  onlyUnread?: boolean;
  onlyStarred?: boolean;
  search?: string | null;
  since?: number | null;
  limit?: number | null;
  offset?: number | null;
  mode?: 'list' | 'full';
};

export function listEntries(params: ListEntriesParams & { mode: 'list' }): EntryListItem[];
export function listEntries(params: ListEntriesParams & { mode?: 'full' | undefined }): Entry[];
export function listEntries(params: ListEntriesParams): Array<Entry | EntryListItem>;
export function listEntries(params: ListEntriesParams): Array<Entry | EntryListItem> {
  const database = getDb();
  const conditions: string[] = [];
  const values: Array<string | number> = [];

  if (params.feedId) {
    conditions.push('entries.feed_id = ?');
    values.push(params.feedId);
  }
  if (params.onlyUnread) {
    conditions.push('entries.is_read = 0');
  }
  if (params.onlyStarred) {
    conditions.push('entries.is_starred = 1');
  }
  if (params.since) {
    conditions.push('COALESCE(entries.published_at, entries.created_at) >= ?');
    values.push(params.since);
  }

  const entryColumns = params.mode === 'list'
    ? `entries.id as id,
      entries.feed_id as feedId,
      entries.title as title,
      entries.link as link,
      entries.published_at as publishedAt,
      entries.summary as summary,
      entries.media_url as mediaUrl,
      entries.media_type as mediaType,
      entries.is_read as isRead,
      entries.is_starred as isStarred,
      entries.created_at as createdAt,
      entries.content_fetch_status as contentFetchStatus,
      entries.content_fetched_at as contentFetchedAt,
      entries.content_fetch_attempted_at as contentFetchAttemptedAt,
      entries.content_fetch_error as contentFetchError,
      LENGTH(COALESCE(entries.content_text, entries.content_html, '')) as contentLength`
    : `entries.id as id,
      entries.feed_id as feedId,
      entries.guid as guid,
      entries.title as title,
      entries.link as link,
      entries.author as author,
      entries.published_at as publishedAt,
      entries.summary as summary,
      entries.content_html as contentHtml,
      entries.content_text as contentText,
      entries.media_url as mediaUrl,
      entries.media_type as mediaType,
      entries.is_read as isRead,
      entries.is_starred as isStarred,
      entries.created_at as createdAt,
      entries.content_fetch_status as contentFetchStatus,
      entries.content_fetched_at as contentFetchedAt,
      entries.content_fetch_attempted_at as contentFetchAttemptedAt,
      entries.content_fetch_error as contentFetchError,
      LENGTH(COALESCE(entries.content_text, entries.content_html, '')) as contentLength`;

  let baseQuery = `SELECT
      ${entryColumns}
    FROM entries`;

  if (params.search?.trim()) {
    baseQuery = `SELECT
      ${entryColumns}
    FROM entries JOIN entries_fts ON entries_fts.rowid = entries.rowid`;
    conditions.push('entries_fts MATCH ?');
    values.push(plainTextSearch(params.search));
  }

  if (params.cursor) {
    conditions.push('(COALESCE(entries.published_at, entries.created_at), entries.created_at, entries.id) < (?, ?, ?)');
    values.push(params.cursor.sortAt, params.cursor.createdAt, params.cursor.id);
  }
  const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const limit = params.limit !== undefined && params.limit !== null
    ? Math.max(1, Math.min(500, Math.floor(params.limit)))
    : null;
  const offset = limit !== null
    ? Math.max(0, Math.floor(params.offset ?? 0))
    : 0;
  const paginationClause = limit !== null ? ' LIMIT ? OFFSET ?' : '';
  const rows = database
    .prepare(`${baseQuery}${whereClause} ORDER BY COALESCE(entries.published_at, entries.created_at) DESC, entries.created_at DESC, entries.id DESC${paginationClause}`)
    .all(...values, ...(limit !== null ? [limit, offset] : []));
  return rows as Array<Entry | EntryListItem>;
}

export function getEntry(id: string): Entry | null {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT
         id as id,
         feed_id as feedId,
         guid as guid,
         title as title,
         link as link,
         author as author,
         published_at as publishedAt,
         summary as summary,
         content_html as contentHtml,
         content_text as contentText,
         media_url as mediaUrl,
         media_type as mediaType,
         is_read as isRead,
         is_starred as isStarred,
         created_at as createdAt,
         content_fetch_status as contentFetchStatus,
         content_fetched_at as contentFetchedAt,
         content_fetch_attempted_at as contentFetchAttemptedAt,
         content_fetch_error as contentFetchError,
         LENGTH(COALESCE(content_text, content_html, '')) as contentLength
       FROM entries
       WHERE id = ?`,
    )
    .get(id) as Entry | undefined;
  return row ?? null;
}

export function markEntryContentFetchStarted(id: string) {
  const database = getDb();
  database
    .prepare(
      `UPDATE entries
       SET content_fetch_status = 'fetching',
           content_fetch_attempted_at = ?,
           content_fetch_error = NULL
       WHERE id = ?`,
    )
    .run(Date.now(), id);
}

export function markEntryContentFetchResult(
  id: string,
  input: {
    status: 'fetched' | 'no_content' | 'auth_required' | 'failed';
    error?: string | null;
    fetchedAt?: number | null;
    attemptedAt?: number | null;
  },
) {
  const database = getDb();
  const attemptedAt = input.attemptedAt ?? Date.now();
  const fetchedAt = input.status === 'fetched' ? (input.fetchedAt ?? attemptedAt) : null;
  database
    .prepare(
      `UPDATE entries
       SET content_fetch_status = ?,
           content_fetched_at = ?,
           content_fetch_attempted_at = ?,
           content_fetch_error = ?
       WHERE id = ?`,
    )
    .run(input.status, fetchedAt, attemptedAt, input.error ?? null, id);
}

export function updateEntryContent(id: string, contentHtml: string, options?: { markFetched?: boolean; fetchedAt?: number | null }) {
  const database = getDb();
  measureTransaction(() => database.transaction(() => {
  const contentText = contentHtml ? stripHtml(contentHtml) : null;
  const summaryText = contentText ? contentText.slice(0, 280) : null;
  const fetchedAt = options?.fetchedAt ?? Date.now();
  database
    .prepare(
      `UPDATE entries
       SET content_html = ?, content_text = ?,
           summary = CASE WHEN summary IS NULL OR LENGTH(summary) < 80 THEN ? ELSE summary END,
           content_fetch_status = CASE WHEN ? THEN 'fetched' ELSE content_fetch_status END,
           content_fetched_at = CASE WHEN ? THEN ? ELSE content_fetched_at END,
           content_fetch_attempted_at = CASE WHEN ? THEN ? ELSE content_fetch_attempted_at END,
           content_fetch_error = CASE WHEN ? THEN NULL ELSE content_fetch_error END
       WHERE id = ?`,
    )
    .run(
      contentHtml ?? null,
      contentText,
      summaryText,
      options?.markFetched ? 1 : 0,
      options?.markFetched ? 1 : 0,
      fetchedAt,
      options?.markFetched ? 1 : 0,
      fetchedAt,
      options?.markFetched ? 1 : 0,
      id,
    );
  const updated = database.prepare('SELECT title, summary FROM entries WHERE id = ?').get(id) as
    | { title: string | null; summary: string | null }
    | undefined;
  updateEntryFts(id, updated?.title ?? null, updated?.summary ?? summaryText, contentText);
  }).immediate());
}

export function updateEntryMedia(id: string, mediaUrl: string | null, mediaType: string | null) {
  const database = getDb();
  database.prepare('UPDATE entries SET media_url = ?, media_type = ? WHERE id = ?').run(mediaUrl ?? null, mediaType ?? null, id);
}

export function markEntryRead(id: string, isRead: boolean) {
  const database = getDb();
  database.prepare('UPDATE entries SET is_read = ? WHERE id = ?').run(isRead ? 1 : 0, id);
}

export function markAllEntriesRead(feedId?: string): number {
  const database = getDb();
  if (feedId !== undefined) {
    return database.prepare('UPDATE entries SET is_read = 1 WHERE is_read = 0 AND feed_id = ?').run(feedId).changes;
  }
  return database.prepare('UPDATE entries SET is_read = 1 WHERE is_read = 0').run().changes;
}

export function toggleEntryStar(id: string) {
  const database = getDb();
  const row = database.prepare('UPDATE entries SET is_starred = 1 - is_starred WHERE id = ? RETURNING is_starred AS value').get(id) as { value: number } | undefined;
  return row?.value ?? 0;
}

export function rebuildSearchIndex(progress?: (completed: number, total: number) => void) {
  const database = getDb();
  return measureTransaction(() => database.transaction(() => {
    const total = (database.prepare('SELECT COUNT(*) AS count FROM entries').get() as { count: number }).count;
    database.exec('DELETE FROM entries_fts');
    let rowid = 0, completed = 0;
    progress?.(0, total);
    const select = database.prepare('SELECT rowid FROM entries WHERE rowid > ? ORDER BY rowid LIMIT 1000');
    const insert = database.prepare(`INSERT INTO entries_fts(rowid, entry_id, title, summary, content_text)
      SELECT rowid, id, COALESCE(title, ''), COALESCE(summary, ''), COALESCE(content_text, '') FROM entries WHERE rowid > ? AND rowid <= ?`);
    while (completed < total) {
      const rows = select.all(rowid) as Array<{ rowid: number }>;
      const last = rows[rows.length - 1].rowid;
      insert.run(rowid, last); rowid = last; completed += rows.length;
      progress?.(completed, total);
    }
    return { ok: true, entries: total };
  }).immediate());
}
