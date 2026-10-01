import { JSDOM } from 'jsdom';
import { fetchWithTimeout } from '../network/http';
import { resolveFeedUrlFromInput } from '../sources/rsshub';

const DISCOVERY_TIMEOUT_MS = 12_000;
const MAX_DISCOVERY_DOCUMENT_LENGTH = 2 * 1024 * 1024;
const FEED_MIME_TYPES = new Set([
  'application/rss+xml',
  'application/atom+xml',
  'application/rdf+xml',
]);

export type DiscoveredFeed = {
  url: string;
  title: string | null;
  siteUrl: string | null;
  source: 'known-platform' | 'direct-feed' | 'html-alternate';
};

function normalizeHttpUrl(input: string) {
  const trimmed = input.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('FEED_DISCOVERY_URL_INVALID');
  return parsed.href;
}

function canonicalUrl(url: string) {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function looksLikeFeedUrl(url: string) {
  const lowered = url.toLowerCase();
  return (
    /\.(?:xml|rss|atom|rdf)(?:$|[?#])/.test(lowered)
    || /\/(?:feed|feeds|rss|atom)(?:\/|$|[?#])/.test(lowered)
    || /[?&](?:format|output)=(?:rss|atom)/.test(lowered)
  );
}

function looksLikeFeedDocument(body: string) {
  const head = body.slice(0, 4_000).replace(/^\uFEFF/, '').trimStart().toLowerCase();
  return (
    head.startsWith('<rss')
    || head.startsWith('<feed')
    || head.startsWith('<rdf:rdf')
    || /<rss(?:\s|>)/.test(head)
    || /<feed(?:\s|>)/.test(head)
    || /<rdf:rdf(?:\s|>)/.test(head)
  );
}

function cleanTitle(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function dedupeCandidates(candidates: DiscoveredFeed[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = canonicalUrl(candidate.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

export function discoverFeedsFromDocument(input: {
  siteUrl: string;
  responseUrl: string;
  body: string;
  contentType?: string | null;
}) {
  const siteUrl = normalizeHttpUrl(input.siteUrl);
  const responseUrl = normalizeHttpUrl(input.responseUrl);
  const body = input.body.slice(0, MAX_DISCOVERY_DOCUMENT_LENGTH);
  if (looksLikeFeedDocument(body)) {
    return [{
      url: responseUrl,
      title: null,
      siteUrl: responseUrl === siteUrl ? null : siteUrl,
      source: 'direct-feed' as const,
    }];
  }

  const contentType = (input.contentType ?? '').split(';')[0].trim().toLowerCase();
  const isHtml = contentType.includes('html') || /<!doctype\s+html|<html(?:\s|>)/i.test(body.slice(0, 4_000));
  if (!isHtml) return [];

  const dom = new JSDOM(body, { url: responseUrl });
  const pageTitle = cleanTitle(dom.window.document.querySelector('title')?.textContent);
  const links = Array.from(dom.window.document.querySelectorAll('link[rel][href]')) as Array<{
    rel: string;
    type: string;
    title: string;
    getAttribute: (name: string) => string | null;
  }>;
  const discovered = links
    .filter((link) => link.rel.toLowerCase().split(/\s+/).includes('alternate'))
    .filter((link) => FEED_MIME_TYPES.has(link.type.toLowerCase().split(';')[0].trim()))
    .flatMap((link): DiscoveredFeed[] => {
      try {
        const url = new URL(link.getAttribute('href') ?? '', responseUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
        return [{
          url: url.href,
          title: cleanTitle(link.title) ?? pageTitle,
          siteUrl: responseUrl,
          source: 'html-alternate',
        }];
      } catch {
        return [];
      }
    });
  return dedupeCandidates(discovered);
}

export async function discoverFeeds(input: string): Promise<{
  ok: true;
  siteUrl: string;
  candidates: DiscoveredFeed[];
  warning?: string;
}> {
  const siteUrl = normalizeHttpUrl(input);
  const resolved = resolveFeedUrlFromInput(siteUrl);
  if (resolved.url !== siteUrl) {
    return {
      ok: true,
      siteUrl,
      candidates: [{
        url: resolved.url,
        title: null,
        siteUrl: resolved.siteUrl ?? siteUrl,
        source: 'known-platform',
      }],
    };
  }

  const tentativeCandidates: DiscoveredFeed[] = looksLikeFeedUrl(siteUrl)
    ? [{ url: siteUrl, title: null, siteUrl: resolved.siteUrl ?? null, source: 'direct-feed' }]
    : [];

  try {
    const response = await fetchWithTimeout(
      siteUrl,
      {
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
        },
      },
      DISCOVERY_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error(`FEED_DISCOVERY_HTTP_${response.status}`);
    const responseUrl = normalizeHttpUrl(response.url || siteUrl);
    const body = await response.text();
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const discoveredFromDocument = discoverFeedsFromDocument({
      siteUrl,
      responseUrl,
      body,
      contentType,
    });
    if (discoveredFromDocument.length > 0 && discoveredFromDocument[0].source === 'direct-feed') {
      return {
        ok: true,
        siteUrl,
        candidates: discoveredFromDocument,
      };
    }

    return {
      ok: true,
      siteUrl,
      candidates: dedupeCandidates([...discoveredFromDocument, ...tentativeCandidates]),
    };
  } catch (error) {
    if (tentativeCandidates.length > 0) {
      return {
        ok: true,
        siteUrl,
        candidates: tentativeCandidates,
        warning: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}
