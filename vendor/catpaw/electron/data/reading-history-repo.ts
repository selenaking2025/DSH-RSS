import { getDb } from './db-core';
import { getEntry } from './entry-repo';
import { articleSummarySourceHash } from './article-summary-repo';
import { getReadingFocus } from './reading-focus-repo';
import { sourceStillCurrent } from './reading-entry-repo';
import { ReadingError, READING_RULE_VERSION, type ReadingFeedback, type ReadingProgress } from '../contracts/smart-reading';

export type ReadingHistory = { entryId: string; sourceHash: string; kind: 'opened' | 'known'; title: string; excerpt: string; occurredAt: number; feedRevision: number };
export function recordReadingVisit(entryId: string, kind: ReadingHistory['kind'] = 'opened') {
  const entry = getEntry(entryId); if (!entry) return;
  // A snapshot is evidence of what was available, not proof that the reader learned it.
  const text = entry.contentText || entry.summary || '';
  const excerpt = text.length <= 12000 ? text : `${text.slice(0, 6000)}\n[…]\n${text.slice(-6000)}`;
  const hash = articleSummarySourceHash(entry);
  const previous = getDb().prepare('SELECT source_hash AS hash FROM reading_history WHERE entry_id=? AND kind=?').get(entryId, kind) as { hash: string } | undefined;
  getDb().prepare(`INSERT INTO reading_history VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(entry_id,kind)
    DO UPDATE SET source_hash=excluded.source_hash,title=excluded.title,excerpt=excluded.excerpt,occurred_at=excluded.occurred_at`)
    .run(entryId, hash, kind, entry.title ?? '', excerpt, Date.now());
  if (previous && previous.hash !== hash) invalidateHistoryComparisons(entryId);
}
function invalidateHistoryComparisons(entryId: string) {
  getDb().prepare('DELETE FROM reading_comparison_contexts WHERE entry_id IN (SELECT entry_id FROM reading_progress WHERE previous_entry_id=?)').run(entryId);
  getDb().prepare('DELETE FROM reading_progress WHERE previous_entry_id=?').run(entryId);
}
export function listReadingHistory(excludeId: string, limit = 150): ReadingHistory[] {
  return getDb().prepare(`SELECT h.entry_id AS entryId,h.source_hash AS sourceHash,h.kind,h.title,h.excerpt,h.occurred_at AS occurredAt,f.sync_revision AS feedRevision
    FROM reading_history h JOIN entries e ON e.id=h.entry_id JOIN feeds f ON f.id=e.feed_id WHERE h.entry_id<>? ORDER BY h.occurred_at DESC LIMIT ?`).all(excludeId, limit) as ReadingHistory[];
}
export function saveReadingFeedback(entryId: string, focusId: string, value: ReadingFeedback | null) {
  getDb().transaction(() => {
    if (!getEntry(entryId) || !getReadingFocus(focusId)) throw new ReadingError('文章或关注事项已不存在。');
    if (value === null) getDb().prepare('DELETE FROM reading_feedback WHERE entry_id=? AND focus_id=?').run(entryId, focusId);
    else getDb().prepare(`INSERT INTO reading_feedback VALUES (?, ?, ?, ?) ON CONFLICT(entry_id,focus_id)
      DO UPDATE SET value=excluded.value,saved_at=excluded.saved_at`).run(entryId, focusId, value, Date.now());
    if (value === 'known') recordReadingVisit(entryId, 'known');
    else if (!(getDb().prepare("SELECT 1 FROM reading_feedback WHERE entry_id=? AND value='known'").get(entryId))) {
      const removed = getDb().prepare("DELETE FROM reading_history WHERE entry_id=? AND kind='known'").run(entryId);
      if (removed.changes) invalidateHistoryComparisons(entryId);
    }
  }).immediate();
}
export function findReadingRelation(leftId: string, rightId: string, model: string) {
  const [left, right] = [leftId, rightId].sort();
  const row = getDb().prepare('SELECT * FROM reading_relations WHERE left_id=? AND right_id=?').get(left, right) as
    { left_hash: string; right_hash: string; same_event: number; confidence: number; overridden: number; model: string; rule_version: number } | undefined;
  if (!row || (!row.overridden && (row.model !== model || row.rule_version !== READING_RULE_VERSION))) return null;
  if (!sourceStillCurrent(left, row.left_hash) || !sourceStillCurrent(right, row.right_hash)) return null;
  return { sameEvent: Boolean(row.same_event), confidence: row.confidence, overridden: Boolean(row.overridden) };
}
export function listReadingRelations(model: string): Array<{ leftId: string; rightId: string; sameEvent: number; overridden: number }> {
  return getDb().prepare(`SELECT left_id AS leftId,right_id AS rightId,same_event AS sameEvent,overridden FROM reading_relations
    WHERE (model=? AND rule_version=?) OR overridden=1 ORDER BY saved_at DESC LIMIT 20000`).all(model, READING_RULE_VERSION) as
    Array<{ leftId: string; rightId: string; sameEvent: number; overridden: number }>;
}
export function saveReadingRelation(leftId: string, leftHash: string, rightId: string, rightHash: string, model: string,
  sameEvent: boolean, confidence: number, overridden = false, revisions?: { left: number; right: number }) {
  if (leftId === rightId) return false;
  const [left, right] = [{ id: leftId, hash: leftHash }, { id: rightId, hash: rightHash }].sort((a, b) => a.id < b.id ? -1 : 1);
  return getDb().transaction(() => {
    if (revisions && (!sourceStillCurrent(leftId, leftHash, revisions.left) || !sourceStillCurrent(rightId, rightHash, revisions.right))) return false;
    if (!sourceStillCurrent(left.id, left.hash) || !sourceStillCurrent(right.id, right.hash)) return false;
    if (!overridden && getDb().prepare('SELECT 1 FROM reading_relations WHERE left_id=? AND right_id=? AND overridden=1').get(left.id, right.id)) return false;
    getDb().prepare(`INSERT INTO reading_relations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(left_id,right_id)
      DO UPDATE SET left_hash=excluded.left_hash,right_hash=excluded.right_hash,model=excluded.model,rule_version=excluded.rule_version,
      same_event=excluded.same_event,confidence=excluded.confidence,overridden=excluded.overridden,saved_at=excluded.saved_at`)
      .run(left.id, right.id, left.hash, right.hash, model, READING_RULE_VERSION, +sameEvent, confidence, +overridden, Date.now());
    return true;
  }).immediate();
}
export function splitReadingEvent(leftId: string, rightId: string) {
  const left = getEntry(leftId), right = getEntry(rightId);
  if (!left || !right) throw new ReadingError('事件中的文章已不存在。');
  saveReadingRelation(leftId, articleSummarySourceHash(left), rightId, articleSummarySourceHash(right), 'user', false, 1, true);
}
export function findReadingProgress(entryId: string, model: string): ReadingProgress | null {
  const row = getDb().prepare(`SELECT result,source_hash AS hash,previous_entry_id AS previousId,previous_hash AS previousHash
    FROM reading_progress WHERE entry_id=? AND model=? AND rule_version=?`).get(entryId, model, READING_RULE_VERSION) as
    { result: string; hash: string; previousId: string; previousHash: string } | undefined;
  if (!row || !sourceStillCurrent(entryId, row.hash)) return null;
  const history = getDb().prepare('SELECT 1 FROM reading_history WHERE entry_id=? AND source_hash=?').get(row.previousId, row.previousHash);
  return history ? JSON.parse(row.result) : null;
}
export function saveReadingProgress(entryId: string, hash: string, model: string, progress: ReadingProgress) {
  return getDb().transaction(() => {
    if (!sourceStillCurrent(entryId, hash) || !getDb().prepare('SELECT 1 FROM reading_history WHERE entry_id=? AND source_hash=?')
      .get(progress.previousEntryId, progress.previousHash)) return false;
    getDb().prepare(`INSERT INTO reading_progress VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entry_id)
      DO UPDATE SET source_hash=excluded.source_hash,previous_entry_id=excluded.previous_entry_id,previous_hash=excluded.previous_hash,
      model=excluded.model,rule_version=excluded.rule_version,result=excluded.result,saved_at=excluded.saved_at`)
      .run(entryId, hash, progress.previousEntryId, progress.previousHash, model, READING_RULE_VERSION, JSON.stringify(progress), Date.now());
    return true;
  }).immediate();
}
export function readingComparisonContext(entryId: string, hash: string, model: string) {
  return getDb().prepare(`SELECT event_context AS events,history_context AS history FROM reading_comparison_contexts
    WHERE entry_id=? AND source_hash=? AND model=? AND rule_version=?`).get(entryId, hash, model, READING_RULE_VERSION) as
    { events: string; history: string } | undefined;
}
export function saveReadingComparisonContext(entryId: string, hash: string, model: string, events: string, history: string, progress: ReadingProgress | null,
  ownership?: { feedRevision: number; previous?: { entryId: string; sourceHash: string; feedRevision: number } }) {
  return getDb().transaction(() => {
    if (!sourceStillCurrent(entryId, hash, ownership?.feedRevision)) return false;
    if (ownership?.previous) {
      const previous = ownership.previous;
      if (!getDb().prepare(`SELECT 1 FROM reading_history h JOIN entries e ON e.id=h.entry_id JOIN feeds f ON f.id=e.feed_id
        WHERE h.entry_id=? AND h.source_hash=? AND f.sync_revision=?`).get(previous.entryId, previous.sourceHash, previous.feedRevision)) return false;
    }
    if (progress && !saveReadingProgress(entryId, hash, model, progress)) return false;
    if (!progress) getDb().prepare('DELETE FROM reading_progress WHERE entry_id=?').run(entryId);
    getDb().prepare(`INSERT INTO reading_comparison_contexts VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(entry_id)
      DO UPDATE SET source_hash=excluded.source_hash,model=excluded.model,rule_version=excluded.rule_version,
      event_context=excluded.event_context,history_context=excluded.history_context`)
      .run(entryId, hash, model, READING_RULE_VERSION, events, history);
    return true;
  }).immediate();
}
