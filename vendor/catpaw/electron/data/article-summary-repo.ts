import { createHash } from 'node:crypto';
import { getDb } from './db-core';
import { getEntry } from './entry-repo';
import type { Entry } from '../contracts/reader';
import { SUMMARY_VERSION, SummaryError, type ArticleSummary } from '../contracts/article-summary';

export function articleSummarySourceHash(entry: Entry) {
  return createHash('sha256').update(JSON.stringify({ version: SUMMARY_VERSION, title: entry.title,
    html: entry.contentHtml, text: entry.contentText, excerpt: entry.summary, fetched: entry.contentFetchStatus === 'fetched' })).digest('hex');
}

export function findArticleSummary(entryId: string): ArticleSummary | null {
  const entry = getEntry(entryId);
  if (!entry) return null;
  const row = getDb().prepare(`SELECT summary, source_kind AS sourceKind, provider_id AS providerId, model, saved_at AS savedAt
    FROM article_summaries WHERE entry_id = ? AND source_hash = ?`).get(entryId, articleSummarySourceHash(entry)) as ArticleSummary | undefined;
  return row ?? null;
}

export function saveArticleSummary(entryId: string, sourceHash: string, result: ArticleSummary) {
  if (!result.summary.trim() || result.summary.length > 600) throw new SummaryError('摘要内容不完整，请重新生成。');
  // The source check and write share a transaction: late results cannot replace a changed/deleted article.
  getDb().transaction(() => {
    const entry = getEntry(entryId);
    if (!entry || articleSummarySourceHash(entry) !== sourceHash) throw new SummaryError('文章内容已更新，请重新生成摘要。');
    getDb().prepare(`INSERT INTO article_summaries (entry_id, source_hash, summary, source_kind, provider_id, model, saved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (entry_id) DO UPDATE SET source_hash = excluded.source_hash,
      summary = excluded.summary, source_kind = excluded.source_kind, provider_id = excluded.provider_id,
      model = excluded.model, saved_at = excluded.saved_at`).run(entryId, sourceHash, result.summary, result.sourceKind,
      result.providerId, result.model, result.savedAt);
  }).immediate();
}
