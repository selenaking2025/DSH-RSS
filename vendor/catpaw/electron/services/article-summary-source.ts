import { JSDOM } from 'jsdom';
import { getEntry } from '../data/entry-repo';
import { articleSummarySourceHash } from '../data/article-summary-repo';
import type { Entry } from '../contracts/reader';
import { SUMMARY_SOURCE_LIMIT, SummaryError, type PreparedSummarySource, type SummarySource } from '../contracts/article-summary';

function plainText(html: string | null | undefined) {
  if (!html?.trim()) return '';
  const dom = new JSDOM(html);
  try {
    const body = dom.window.document.body as HTMLElement;
    body.querySelectorAll('script,style,noscript,nav,footer,form,button,iframe,svg,[hidden],[aria-hidden="true"]').forEach((node) => node.remove());
    body.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
    body.querySelectorAll('p,div,li,blockquote,h1,h2,h3,h4,section,tr,pre').forEach((node) => node.append('\n'));
    return (body.textContent ?? '').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  } finally { dom.window.close(); }
}

export function extractSummarySource(entry: Entry): SummarySource {
  const body = entry.contentHtml?.trim() ? plainText(entry.contentHtml) : plainText(entry.contentText);
  const excerpt = plainText(entry.summary);
  const text = body || excerpt;
  if (text.length > SUMMARY_SOURCE_LIMIT) throw new SummaryError('这篇文章超过 24 万字符，暂时无法完整生成摘要。');
  if ((text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 20) throw new SummaryError('正文内容不足，请先获取全文后再生成摘要。');
  const sameAsExcerpt = body.replace(/\s/g, '') === excerpt.replace(/\s/g, '');
  const sourceKind = entry.contentFetchStatus === 'fetched' && body ? 'content'
    : !body || sameAsExcerpt || /(?:阅读全文|阅读原文|read more|continue reading|\[\s*…\s*\])\s*[.。…›»]*$/i.test(text) ? 'excerpt' : 'content';
  return { title: entry.title ?? '', text, sourceKind, sourceHash: articleSummarySourceHash(entry) };
}

// HTML parsing runs in the existing reader worker, never on Electron's UI thread.
export function prepareArticleSummarySource(entryId: string): PreparedSummarySource {
  try {
    const entry = getEntry(entryId);
    if (!entry) throw new SummaryError('文章已不存在，请重新选择文章。');
    return { ok: true, source: extractSummarySource(entry) };
  } catch (error) {
    return { ok: false, error: error instanceof SummaryError ? error.message : '读取文章正文失败，请稍后重试。' };
  }
}
