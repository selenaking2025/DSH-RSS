import type Parser from 'rss-parser';
import { upsertEntry } from '../data/entry-repo';
import type { FeedSyncTarget } from '../data/feed-sync-repo';
import { detectEntryMediaType } from '../sources/content-type';
import { resolveWeChatBackfillUrlFromEntryLink } from '../sources/rsshub';

type RssItem = Parser.Item & { id?: string; author?: string; summary?: string; content?: string; 'content:encoded'?: string;
  'media:content'?: { $?: { url?: string; type?: string } } | Array<{ $?: { url?: string; type?: string } }> };
const MAIN_THREAD_YIELD_EVERY = 40;
const yieldMainThread = () => new Promise<void>((resolve) => setImmediate(resolve));

function parseDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function pickContent(item: RssItem) {
  return (
    item['content:encoded'] ||
    item.content ||
    item.summary ||
    item.contentSnippet ||
    null
  );
}

function parseAttr(tag: string, attr: string) {
  const match = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? match[1] : null;
}

function resolveHeaderUrl(value: string | null, currentUrl: string) {
  if (!value) return null;
  try {
    return new URL(value.trim(), currentUrl).toString();
  } catch {
    return null;
  }
}

function resolveLinkHeaderNextUrl(linkHeader: string | null, currentUrl: string) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const urlMatch = part.match(/<([^>]+)>/);
    if (!urlMatch) continue;
    if (!/rel\s*=\s*"?next"?/i.test(part)) continue;
    try {
      return new URL(urlMatch[1], currentUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

export function resolveNextPageUrl(currentUrl: string, xml: string, response: Response) {
  const headerCandidates = [
    response.headers.get('x-rsshub-next-url'),
    response.headers.get('x-next-url'),
    response.headers.get('x-next-page'),
    response.headers.get('next-url'),
    response.headers.get('next'),
  ];
  for (const headerValue of headerCandidates) {
    const resolved = resolveHeaderUrl(headerValue, currentUrl);
    if (resolved) return resolved;
  }

  const linkHeaderNext = resolveLinkHeaderNextUrl(response.headers.get('link'), currentUrl);
  if (linkHeaderNext) return linkHeaderNext;

  const tagRegex = /<(?:(?:atom:)?link)\b[^>]*>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = tagRegex.exec(xml)) !== null) {
    const tag = match[0];
    const rel = parseAttr(tag, 'rel');
    const href = parseAttr(tag, 'href');
    if (!href || !rel || !rel.toLowerCase().includes('next')) continue;
    try {
      return new URL(href, currentUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeUrlLike(input?: string | null) {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return null;
}

function getHost(input?: string | null) {
  if (!input) return null;
  try {
    return new URL(input).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function chooseFeedSiteUrl(currentSiteUrl: string | null | undefined, parsedLink: string | null | undefined, feedUrl: string) {
  const normalizedCurrent = normalizeUrlLike(currentSiteUrl ?? null);
  const normalizedParsed = normalizeUrlLike(parsedLink ?? null);
  if (!normalizedParsed) return normalizedCurrent ?? null;
  if (!normalizedCurrent) return normalizedParsed;
  if (normalizedCurrent === normalizedParsed) return normalizedCurrent;

  const currentHost = getHost(normalizedCurrent);
  const parsedHost = getHost(normalizedParsed);
  const feedHost = getHost(feedUrl);

  // Keep canonical source URL when we only have a bridge URL (wechat2rss/rsshub)
  // but parsed channel link points to original site.
  if ((currentHost?.includes('wechat2rss') || currentHost?.includes('rsshub') || currentHost?.includes('bestblogs.dev')) && parsedHost) {
    return normalizedParsed;
  }

  // If current site URL equals the feed URL, parsed link is usually richer.
  if (normalizedCurrent === feedUrl && parsedHost && parsedHost !== feedHost) {
    return normalizedParsed;
  }

  return normalizedCurrent;
}

export async function saveRssItems(items: RssItem[], feedId: string, syncTarget: FeedSyncTarget,
  backfillUntil: number, sourceRsshubBase: string | null) {
  let scannedItems = 0;
  let pageHasRecentItems = false;
  let pageHasOlderItems = false;
  let sourceFallbackBackfillUrl: string | null = null;
  for (const item of items) {
    const contentHtml = pickContent(item);
    sourceFallbackBackfillUrl ??= resolveWeChatBackfillUrlFromEntryLink(item.link ?? null, sourceRsshubBase);
    const publishedAt = parseDate(item.isoDate ?? item.pubDate);
    if (publishedAt && publishedAt < backfillUntil) {
      pageHasOlderItems = true;
      continue;
    }
    const mediaContent = item['media:content'];
    const media = detectEntryMediaType({
      enclosure: item.enclosure,
      mediaContents: Array.isArray(mediaContent) ? mediaContent : mediaContent ? [mediaContent] : [],
      link: item.link ?? null,
    });
    upsertEntry({
      feedId,
      syncTarget,
      guid: item.guid ?? item.id ?? null,
      title: item.title ?? null,
      link: item.link ?? null,
      author: item.creator ?? item.author ?? null,
      publishedAt,
      summary: item.contentSnippet ?? item.summary ?? null,
      contentHtml,
      mediaUrl: media.mediaUrl,
      mediaType: media.mediaType,
    });
    pageHasRecentItems = true;
    scannedItems += 1;
    if (scannedItems % MAIN_THREAD_YIELD_EVERY === 0) await yieldMainThread();
  }
  return { scannedItems, pageHasRecentItems, pageHasOlderItems, sourceFallbackBackfillUrl };
}
