import { SUMMARY_SOURCE_LIMIT, type PreparedSummarySource } from './article-summary';
import type { RssResult } from './rss';

export type ReaderJobResults = {
  fetch_entry_content: RssResult<'fetchEntryContent'>;
  resolve_xiaoyuzhou_audio: RssResult<'resolveXiaoyuzhouAudio'>;
  get_social_thread: RssResult<'getSocialThread'>;
  prepare_article_summary: PreparedSummarySource;
};
export type ReaderJobKind = keyof ReaderJobResults;

/** The child process is a runtime boundary too; unknown payloads never reach the UI. */
export function parseReaderJobResult<K extends ReaderJobKind>(kind: K, input: unknown): ReaderJobResults[K] {
  if (!input || typeof input !== 'object') throw new Error('READER_INVALID_RESULT');
  const data = input as Record<string, unknown>;
  let valid = typeof data.ok === 'boolean' && (data.error === undefined || typeof data.error === 'string');
  if (data.ok === false) valid &&= typeof data.error === 'string';
  else if (kind === 'resolve_xiaoyuzhou_audio') valid &&= typeof data.mediaUrl === 'string';
  else if (kind === 'prepare_article_summary') {
    const source = data.source as Record<string, unknown> | undefined;
    valid &&= Boolean(source && typeof source.title === 'string' && typeof source.text === 'string'
      && source.text.trim() && source.text.length <= SUMMARY_SOURCE_LIMIT
      && typeof source.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(source.sourceHash)
      && ['content', 'excerpt'].includes(source.sourceKind as string));
  }
  else if (kind === 'get_social_thread') valid &&= Array.isArray(data.items) && data.items.every((item) => item
    && typeof item.entryId === 'string' && typeof item.tweetId === 'string' && typeof item.link === 'string'
    && typeof item.text === 'string' && (item.publishedAt === null || typeof item.publishedAt === 'number'));
  if (!valid) throw new Error('READER_INVALID_RESULT');
  return input as ReaderJobResults[K];
}
