import { getDb } from './db-core';
import { getEntry } from './entry-repo';
import { articleSummarySourceHash } from './article-summary-repo';
import { getReadingFocus } from './reading-focus-repo';
import { READING_RULE_VERSION, type ReadingAssessment, type ReadingFeedback, type ReadingFocus, type ReadingWindow } from '../contracts/smart-reading';
import type { EntryListItem } from '../contracts/reader';

export type ReadingCandidate = EntryListItem & { assessment: ReadingAssessment | null; sourceHash: string | null;
  feedback: ReadingFeedback | null; savedAt: number; feedRevision: number; estimatedText: string };

function scopedFeedIds(focus: ReadingFocus): string[] | null {
  if (!focus.feedIds.length && !focus.groupIds.length) return null;
  const groups = new Set(focus.groupIds);
  const rows = getDb().prepare('SELECT id, parent_id FROM feed_groups').all() as { id: string; parent_id: string | null }[];
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (row.parent_id && groups.has(row.parent_id) && !groups.has(row.id)) { groups.add(row.id); changed = true; } }
  const feeds = getDb().prepare('SELECT id, group_id FROM feeds').all() as { id: string; group_id: string | null }[];
  return [...new Set([...focus.feedIds, ...feeds.filter((feed) => feed.group_id && groups.has(feed.group_id)).map((feed) => feed.id)])];
}
function scope(focus: ReadingFocus, window: ReadingWindow) {
  const ids = scopedFeedIds(focus);
  const where = ['COALESCE(e.published_at,e.created_at) >= ?', 'COALESCE(e.published_at,e.created_at) < ?'];
  const params: (string | number)[] = [window.since, window.until];
  if (window.onlyUnread) where.push('e.is_read = 0');
  if (ids) { where.push(ids.length ? `e.feed_id IN (${ids.map(() => '?').join(',')})` : '0'); params.push(...ids); }
  return { where: where.join(' AND '), params };
}
const entryColumns = `e.id,e.feed_id AS feedId,e.title,e.link,e.summary,e.published_at AS publishedAt,
  e.media_url AS mediaUrl,e.media_type AS mediaType,e.is_read AS isRead,e.is_starred AS isStarred,e.created_at AS createdAt,
  e.content_fetch_status AS contentFetchStatus,LENGTH(COALESCE(e.content_text,e.content_html,'')) AS contentLength`;

export function listReadingCandidates(focus: ReadingFocus, window: ReadingWindow, model: string, afterId = '', limit = 100): ReadingCandidate[] {
  const scoped = scope(focus, window);
  const rows = getDb().prepare(`SELECT ${entryColumns}, f.sync_revision AS feedRevision,
    s.assessment,s.source_hash AS sourceHash,COALESCE(s.saved_at,0) AS savedAt,b.value AS feedback,
    substr(COALESCE(e.content_text,e.summary,''),1,12000) AS estimatedText
    FROM entries e JOIN feeds f ON f.id = e.feed_id
    LEFT JOIN reading_scores s ON s.entry_id=e.id AND s.focus_id=? AND s.focus_revision=? AND s.model=? AND s.rule_version=?
    LEFT JOIN reading_feedback b ON b.entry_id=e.id AND b.focus_id=?
    WHERE ${scoped.where} AND e.id > ? ORDER BY e.id LIMIT ?`).all(focus.id, focus.revision, model, READING_RULE_VERSION,
    focus.id, ...scoped.params, afterId, limit) as Array<Omit<ReadingCandidate, 'assessment'> & { assessment: string | null }>;
  return rows.map((row) => ({ ...row, assessment: row.assessment ? JSON.parse(row.assessment) : null }));
}
export function countReadingCandidates(focus: ReadingFocus, window: ReadingWindow) {
  const scoped = scope(focus, window);
  return (getDb().prepare(`SELECT count(*) AS n FROM entries e WHERE ${scoped.where}`).get(...scoped.params) as { n: number }).n;
}
export function sourceStillCurrent(entryId: string, hash: string, feedRevision?: number) {
  const entry = getEntry(entryId);
  if (!entry || articleSummarySourceHash(entry) !== hash) return false;
  if (feedRevision === undefined) return true;
  return (getDb().prepare('SELECT sync_revision AS revision FROM feeds WHERE id = ?').get(entry.feedId) as { revision: number } | undefined)?.revision === feedRevision;
}
export function saveReadingScore(input: { entryId: string; sourceHash: string; feedRevision: number; focus: ReadingFocus;
  model: string; assessment: ReadingAssessment }) {
  return getDb().transaction(() => {
    if (getReadingFocus(input.focus.id)?.revision !== input.focus.revision || !sourceStillCurrent(input.entryId, input.sourceHash, input.feedRevision)) return false;
    getDb().prepare(`INSERT INTO reading_scores VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entry_id,focus_id) DO UPDATE SET focus_revision=excluded.focus_revision,source_hash=excluded.source_hash,
      feed_revision=excluded.feed_revision,model=excluded.model,rule_version=excluded.rule_version,assessment=excluded.assessment,saved_at=excluded.saved_at`)
      .run(input.entryId, input.focus.id, input.focus.revision, input.sourceHash, input.feedRevision, input.model,
        READING_RULE_VERSION, JSON.stringify(input.assessment), Date.now());
    return true;
  }).immediate();
}
export function getReadingUsage(day: string) {
  return getDb().prepare('SELECT input_tokens AS inputTokens,requests FROM reading_usage WHERE day = ?').get(day) as { inputTokens: number; requests: number } | undefined
    ?? { inputTokens: 0, requests: 0 };
}
export function reserveReadingTokens(day: string, tokens: number, limit: number) {
  return getDb().transaction(() => {
    const usage = getReadingUsage(day);
    if (usage.inputTokens + tokens > limit) return false;
    getDb().prepare(`INSERT INTO reading_usage VALUES (?, ?, 1) ON CONFLICT(day)
      DO UPDATE SET input_tokens=input_tokens+excluded.input_tokens,requests=requests+1`).run(day, tokens);
    return true;
  }).immediate();
}
export function settleReadingTokens(day: string, reserved: number, actual: number) {
  getDb().prepare('UPDATE reading_usage SET input_tokens=MAX(0,input_tokens + ?) WHERE day=?').run(actual - reserved, day);
}
export function invalidateReadingExcerpts() {
  getDb().prepare("DELETE FROM reading_scores WHERE json_extract(assessment,'$.sourceKind')='excerpt'").run();
}
