import { findProfileForUrl, type HtmlListingProfile } from '../sources/html-listing-metadata';
export { resolveHtmlArticleListingEndpoint } from '../sources/html-listing-metadata';
import { getFeedSyncTarget, type FeedSyncTarget } from '../data/feed-sync-repo';
import { JSDOM } from 'jsdom';
import { upsertEntry } from '../data/entry-repo';
import { listFeedEntryLinks, updateFeedFetchMeta } from '../data/feed-write-repo';
import { fetchWithTimeout } from '../network/http';

type HtmlListingArticle = {
  title: string;
  link: string;
  publishedAt: number | null;
  summary: string | null;
};

function normalizeText(input: string | null | undefined) {
  if (!input) return null;
  const normalized = input.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseDateCandidate(input: string | null | undefined) {
  const normalized = normalizeText(input);
  if (!normalized) return null;
  const timestamp = Date.parse(normalized);
  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  const match = normalized.match(
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}\b/i,
  );
  if (!match?.[0]) {
    return null;
  }
  const parsed = Date.parse(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeArticleLink(href: string, listingUrl: string) {
  try {
    return new URL(href, listingUrl).toString();
  } catch {
    return null;
  }
}

function shouldKeepArticleLink(link: string, listingUrl: string, profile: HtmlListingProfile) {
  try {
    const parsed = new URL(link);
    const listing = new URL(listingUrl);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (host !== profile.siteHost) return false;
    if (parsed.origin !== listing.origin) return false;
    if (path === profile.listingPathPrefix) return false;
    if (!path.startsWith(profile.articlePathPrefix)) return false;
    if (profile.excludedPathPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function findArticleContainer(anchor: any) {
  return anchor.closest('article, li, section, div') ?? anchor.parentElement;
}

function looksLikeJunkTitle(input: string) {
  const lowered = input.toLowerCase();
  return (
    lowered === 'read more'
    || lowered === 'older posts'
    || lowered === 'subscribe'
    || lowered === 'about'
    || lowered === 'learn more'
    || lowered.length < 8
  );
}

function extractArticleTitle(anchor: any, container: any) {
  const candidates = [
    normalizeText(anchor.textContent),
    normalizeText(anchor.querySelector?.('h1, h2, h3, h4')?.textContent ?? null),
    normalizeText(container?.querySelector?.('h1, h2, h3, h4')?.textContent ?? null),
  ];

  for (const candidate of candidates) {
    if (!candidate || looksLikeJunkTitle(candidate)) continue;
    return candidate;
  }
  return null;
}

function extractArticleSummary(container: any, title: string) {
  if (!container) return null;
  const paragraph = container.querySelector('p');
  const summary = normalizeText(paragraph?.textContent ?? null);
  if (!summary || summary === title) {
    return null;
  }
  return summary;
}

function extractArticlePublishedAt(anchor: any, container: any) {
  const timeCandidates = [
    anchor.getAttribute('datetime'),
    anchor.querySelector('time')?.getAttribute('datetime') ?? null,
    container?.querySelector('time')?.getAttribute('datetime') ?? null,
    normalizeText(anchor.querySelector('time')?.textContent ?? null),
    normalizeText(container?.querySelector('time')?.textContent ?? null),
  ];
  for (const candidate of timeCandidates) {
    const parsed = parseDateCandidate(candidate);
    if (parsed) return parsed;
  }

  const textCandidates = [
    normalizeText(anchor.textContent),
    normalizeText(container?.textContent ?? null),
  ];
  for (const candidate of textCandidates) {
    const parsed = parseDateCandidate(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function parseHtmlArticleListing(html: string, listingUrl: string) {
  const profile = findProfileForUrl(listingUrl);
  if (!profile) {
    return [] as HtmlListingArticle[];
  }

  const dom = new JSDOM(html);
  const anchors = Array.from(dom.window.document.querySelectorAll('a[href]'));
  const articles: HtmlListingArticle[] = [];
  const seen = new Set<string>();

  for (const anchor of anchors as any[]) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    const link = normalizeArticleLink(href, listingUrl);
    if (!link || seen.has(link) || !shouldKeepArticleLink(link, listingUrl, profile)) {
      continue;
    }

    const container = findArticleContainer(anchor);
    const title = extractArticleTitle(anchor, container);
    if (!title) continue;

    seen.add(link);
    articles.push({
      title,
      link,
      publishedAt: extractArticlePublishedAt(anchor, container),
      summary: extractArticleSummary(container, title),
    });
  }

  return articles;
}

export async function refreshHtmlArticleListing(input: {
  syncTarget?: FeedSyncTarget;
  feedId: string;
  endpointUrl: string;
}) {
  const syncTarget = input.syncTarget ?? getFeedSyncTarget(input.feedId);
  const response = await fetchWithTimeout(
    input.endpointUrl,
    {
      headers: {
        accept: 'text/html,application/xhtml+xml',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  const articles = parseHtmlArticleListing(html, input.endpointUrl);
  if (articles.length === 0) {
    throw new Error('HTML_ARTICLE_LISTING_EMPTY');
  }

  const recentLinks = new Set(listFeedEntryLinks(input.feedId, 20));
  const limited = articles.slice(0, 20);

  for (const article of limited) {
    upsertEntry({
      feedId: input.feedId,
      syncTarget,
      guid: article.link,
      title: article.title,
      link: article.link,
      publishedAt: article.publishedAt,
      summary: article.summary,
      contentHtml: article.summary ? `<p>${escapeHtml(article.summary)}</p>` : null,
    });
  }

  updateFeedFetchMeta(input.feedId, { lastCheckedAt: Date.now() }, syncTarget);

  return {
    feedId: input.feedId,
    notModified: limited.every((article) => recentLinks.has(article.link)),
  };
}
