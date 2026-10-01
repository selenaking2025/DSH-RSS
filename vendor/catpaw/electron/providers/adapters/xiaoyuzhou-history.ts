import { feedFailure } from '../../feed-errors';
import { getFeedSyncTarget, type FeedSyncTarget } from '../../data/feed-sync-repo';
import { fetchWithTimeout, FEED_FETCH_USER_AGENT } from '../../network/http';
import { upsertEntry } from '../../data/entry-repo';
import { inferRsshubBaseFromFeedUrl } from '../../sources/rsshub';
import { dedupeUrls, toRsshubAppVariant } from '../../sources/source-url-utils';
const FEED_FETCH_TIMEOUT_MS = Number(process.env.CATPAW_FEED_FETCH_TIMEOUT_MS) || 20_000;
const MAIN_THREAD_YIELD_EVERY = 40;
const yieldMainThread = () => new Promise<void>((resolve) => setImmediate(resolve));
const XIAOYUZHOU_EPISODE_LIST_LIMIT = 25;
const XIAOYUZHOU_FEED_HOST = 'feed.xyzfm.space';
const XIAOYUZHOU_DISCOVERY_TTL_MS = 12 * 60 * 60 * 1000;
const xiaoyuzhouFeedDiscoveryCache = new Map<string, { checkedAt: number; urls: string[] }>();
function buildRsshubXiaoyuzhouRoute(baseUrl: string, podcastId: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return `${normalizedBase}/xiaoyuzhou/podcast/${podcastId}`;
}

function isLikelyXiaoyuzhouPodcastPageUrl(input?: string | null) {
  if (!input) return false;
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host.includes('xiaoyuzhoufm.com') && parsed.pathname.toLowerCase().includes('/podcast/');
  } catch {
    return false;
  }
}

export function buildXiaoyuzhouBackfillSeedUrls(input: {
  podcastId: string;
  feedUrl: string;
}) {
  const inferredRsshubBase = inferRsshubBaseFromFeedUrl(input.feedUrl);
  const candidates: Array<string | null | undefined> = [
    buildRsshubXiaoyuzhouRoute('https://rsshub.app', input.podcastId),
    inferredRsshubBase ? buildRsshubXiaoyuzhouRoute(inferredRsshubBase, input.podcastId) : null,
    input.feedUrl,
    toRsshubAppVariant(input.feedUrl),
  ];
  return dedupeUrls(candidates);
}

function normalizeXiaoyuzhouFeedUrl(rawUrl: string) {
  const value = rawUrl.trim().replace(/\\\//g, '/');
  if (!value) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, '')}`;
  try {
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== XIAOYUZHOU_FEED_HOST) return null;
    const token = parsed.pathname.replace(/^\/+/, '').replace(/\.xml$/i, '');
    if (!token || !/^[A-Za-z0-9_-]{6,80}$/.test(token)) return null;
    return `https://${XIAOYUZHOU_FEED_HOST}/${token}.xml`;
  } catch {
    return null;
  }
}

function extractXiaoyuzhouFeedUrlsFromHtml(html: string) {
  const results: string[] = [];
  const push = (candidate: string) => {
    const normalized = normalizeXiaoyuzhouFeedUrl(candidate);
    if (normalized) {
      results.push(normalized);
    }
  };

  const decoded = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');

  const absoluteMatches = decoded.match(/https?:\/\/feed\.xyzfm\.space\/[A-Za-z0-9_-]+(?:\.xml)?/gi) ?? [];
  for (const match of absoluteMatches) {
    push(match);
  }

  const hostOnlyMatches = decoded.match(/feed\.xyzfm\.space\/[A-Za-z0-9_-]+(?:\.xml)?/gi) ?? [];
  for (const match of hostOnlyMatches) {
    push(match);
  }

  return dedupeUrls(results);
}

export async function discoverXiaoyuzhouFeedUrls(input: {
  podcastId: string;
  feedUrl: string;
  siteUrl?: string | null;
}) {
  const cached = xiaoyuzhouFeedDiscoveryCache.get(input.podcastId);
  if (cached && Date.now() - cached.checkedAt < XIAOYUZHOU_DISCOVERY_TTL_MS) {
    return cached.urls;
  }

  const discoveredFromApi: string[] = [];
  const apiProbeUrls = dedupeUrls([
    `https://api.xiaoyuzhoufm.com/v1/podcast/get?pid=${encodeURIComponent(input.podcastId)}`,
    `https://api.xiaoyuzhoufm.com/v1/podcast/get?pid=${encodeURIComponent(input.podcastId)}&show_type=0`,
  ]);
  for (const apiUrl of apiProbeUrls) {
    try {
      const response = await fetchWithTimeout(
        apiUrl,
        {
          headers: {
            accept: 'application/json,text/plain,*/*',
            referer: 'https://www.xiaoyuzhoufm.com/',
            'user-agent': FEED_FETCH_USER_AGENT,
          },
        },
        FEED_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) continue;
      const raw = await response.text();
      const candidates = extractXiaoyuzhouFeedUrlsFromHtml(raw);
      if (candidates.length > 0) {
        discoveredFromApi.push(...candidates);
      }
    } catch {
      // Ignore API discovery failures.
    }
    if (discoveredFromApi.length > 0) break;
  }

  const probePages = dedupeUrls([
    isLikelyXiaoyuzhouPodcastPageUrl(input.siteUrl ?? null) ? input.siteUrl : null,
    isLikelyXiaoyuzhouPodcastPageUrl(input.feedUrl) ? input.feedUrl : null,
    `https://web.xiaoyuzhoufm.com/podcast/${input.podcastId}`,
    `https://www.xiaoyuzhoufm.com/podcast/${input.podcastId}`,
  ]);

  const discovered: string[] = [...discoveredFromApi];
  for (const pageUrl of probePages) {
    try {
      const response = await fetchWithTimeout(
        pageUrl,
        {
          headers: {
            accept: 'text/html,application/xhtml+xml',
            'user-agent': FEED_FETCH_USER_AGENT,
          },
        },
        FEED_FETCH_TIMEOUT_MS,
      );
      if (!response.ok) continue;
      const html = await response.text();
      const candidates = extractXiaoyuzhouFeedUrlsFromHtml(html);
      if (candidates.length > 0) {
        discovered.push(...candidates);
      }
    } catch {
      // Ignore podcast page discovery failures and continue with feed fallback URLs.
    }
    if (discovered.length > 0) break;
  }

  const deduped = dedupeUrls(discovered);
  if (deduped.length > 0) {
    xiaoyuzhouFeedDiscoveryCache.set(input.podcastId, { checkedAt: Date.now(), urls: deduped });
  }
  return deduped;
}

function parseTimestampLike(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    if (value > 1e12) return Math.floor(value);
    if (value > 1e9) return Math.floor(value * 1000);
    return null;
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    return parseTimestampLike(parsed);
  }
  const parsedDate = new Date(trimmed);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.getTime();
}

function hasEpisodeShape(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.eid === 'string' || typeof item.episodeId === 'string' || typeof item.id === 'string';
}

function extractEpisodeRecords(payload: unknown) {
  const queue: unknown[] = [payload];
  const seen = new WeakSet<object>();
  const candidates: Array<Array<Record<string, unknown>>> = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current as object)) continue;
    seen.add(current as object);

    if (Array.isArray(current)) {
      const episodes = current.filter(hasEpisodeShape);
      if (episodes.length > 0) {
        candidates.push(episodes);
      }
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    for (const value of Object.values(current as Record<string, unknown>)) {
      queue.push(value);
    }
  }

  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? [];
}

function extractLoadMoreKey(payload: unknown): string | null {
  const queue: unknown[] = [payload];
  const seen = new WeakSet<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current as object)) continue;
    seen.add(current as object);

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      const looksLikePagingToken =
        normalizedKey.includes('loadmorekey') ||
        normalizedKey.includes('load_more_key') ||
        normalizedKey.includes('nextkey') ||
        ((normalizedKey.includes('loadmore') || normalizedKey.includes('cursor')) && !normalizedKey.includes('url')) ||
        (normalizedKey.startsWith('next') && !normalizedKey.includes('url') && !normalizedKey.includes('title'));

      if (looksLikePagingToken) {
        const serialized = serializeLoadMoreKey(value);
        if (serialized) return serialized;
      }
      queue.push(value);
    }
  }

  return null;
}

function serializeLoadMoreKey(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return `str:${value.trim()}`;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return `num:${Math.floor(value)}`;
  }
  if (value && typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      if (!serialized || serialized === '{}' || serialized === '[]') {
        return null;
      }
      return `json:${serialized}`;
    } catch {
      return null;
    }
  }
  return null;
}

function deserializeLoadMoreKey(value: string) {
  if (value.startsWith('json:')) {
    try {
      return JSON.parse(value.slice(5));
    } catch {
      return null;
    }
  }
  if (value.startsWith('num:')) {
    const token = value.slice(4).trim();
    return token || null;
  }
  if (value.startsWith('str:')) {
    const token = value.slice(4).trim();
    return token || null;
  }
  return value.trim() || null;
}

function pickFirstStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function isLikelyAudioMediaUrl(url: string, keyPath: string) {
  if (!/^https?:\/\//i.test(url)) return false;
  const normalizedPath = keyPath.toLowerCase();
  if (normalizedPath.includes('audio') || normalizedPath.includes('enclosure') || normalizedPath.includes('media')) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (/\.(mp3|aac|m4a|ogg|opus|wav|flac)$/.test(path)) return true;
    const host = parsed.hostname.toLowerCase();
    if (host.includes('media.xyzfm.space') || host.includes('audio') || host.includes('podcast')) return true;
  } catch {
    return false;
  }
  return false;
}

function findFirstAudioMediaUrl(payload: unknown) {
  const queue: Array<{ value: unknown; keyPath: string }> = [{ value: payload, keyPath: '' }];
  const seen = new WeakSet<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (typeof current.value === 'string') {
      if (isLikelyAudioMediaUrl(current.value, current.keyPath)) {
        return current.value;
      }
      continue;
    }

    if (!current.value || typeof current.value !== 'object') continue;
    if (seen.has(current.value as object)) continue;
    seen.add(current.value as object);

    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        queue.push({ value: item, keyPath: current.keyPath });
      }
      continue;
    }

    for (const [key, value] of Object.entries(current.value as Record<string, unknown>)) {
      const nextPath = current.keyPath ? `${current.keyPath}.${key}` : key;
      queue.push({ value, keyPath: nextPath });
    }
  }

  return null;
}

function parseEpisodePublishedAt(record: Record<string, unknown>) {
  const directKeys = ['pubDate', 'publishedAt', 'publishTime', 'published', 'releasedAt', 'releaseAt', 'createdAt', 'date'];
  for (const key of directKeys) {
    const parsed = parseTimestampLike(record[key]);
    if (parsed) return parsed;
  }
  return null;
}

export async function backfillXiaoyuzhouByApi(input: {
  syncTarget?: FeedSyncTarget;
  podcastId: string;
  feedId: string;
  backfillUntil: number;
  maxPages: number;
  shouldStop?: () => boolean;
}) {
  const syncTarget = input.syncTarget ?? getFeedSyncTarget(input.feedId);
  const visitedLoadMoreKeys = new Set<string>();
  let loadMoreKey: string | null = null;
  let scannedItems = 0;
  let pageCount = 0;
  let reachedBoundary = false;

  let historyEnd: 'end' | 'limit' | 'boundary' = 'end';
  try {
    while (pageCount < input.maxPages) {
      if (input.shouldStop?.()) throw new Error('CANCELLED');
      const payload: Record<string, unknown> = {
        pid: input.podcastId,
        limit: XIAOYUZHOU_EPISODE_LIST_LIMIT,
        order: 'desc',
      };
      if (loadMoreKey) {
        const normalizedLoadMoreKey = deserializeLoadMoreKey(loadMoreKey);
        if (normalizedLoadMoreKey) {
          payload.loadMoreKey = normalizedLoadMoreKey;
        }
      }

      const response = await fetchWithTimeout(
        'https://api.xiaoyuzhoufm.com/v1/episode/list',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': FEED_FETCH_USER_AGENT,
            referer: 'https://www.xiaoyuzhoufm.com/',
            applicationid: 'app.podcast.cosmos',
          },
          body: JSON.stringify(payload),
        },
        FEED_FETCH_TIMEOUT_MS,
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const body = (await response.json()) as unknown;
      const episodes = extractEpisodeRecords(body);
      if (episodes.length === 0) {
        break;
      }

      let pageHasRecentItems = false;
      let pageHasOlderItems = false;
      for (const episode of episodes) {
        const episodeId = pickFirstStringField(episode, ['eid', 'episodeId', 'id']);
        if (!episodeId) continue;
        const publishedAt = parseEpisodePublishedAt(episode);
        if (publishedAt && publishedAt < input.backfillUntil) {
          pageHasOlderItems = true;
          continue;
        }

        const title = pickFirstStringField(episode, ['title', 'name']) ?? null;
        const summary = pickFirstStringField(episode, ['shownotes', 'description', 'summary', 'subtitle', 'brief']) ?? null;
        const link = pickFirstStringField(episode, ['shareUrl', 'url', 'webUrl']) ?? `https://www.xiaoyuzhoufm.com/episode/${episodeId}`;
        const mediaUrl = findFirstAudioMediaUrl(episode);

        upsertEntry({
          feedId: input.feedId,
          syncTarget,
          guid: episodeId,
          title,
          link,
          publishedAt,
          summary,
          contentHtml: summary,
          mediaUrl: mediaUrl ?? null,
          mediaType: mediaUrl ? 'audio' : null,
        });
        scannedItems += 1;
        pageHasRecentItems = true;
        if (scannedItems % MAIN_THREAD_YIELD_EVERY === 0) {
          await yieldMainThread();
        }
      }

      if (pageHasOlderItems) {
        reachedBoundary = true;
      }
      pageCount += 1;
      if (pageHasOlderItems && !pageHasRecentItems) {
        historyEnd = 'boundary';
        break;
      }

      const nextLoadMoreKey = extractLoadMoreKey(body);
      if (!nextLoadMoreKey || visitedLoadMoreKeys.has(nextLoadMoreKey)) {
        break;
      }
      visitedLoadMoreKeys.add(nextLoadMoreKey);
      loadMoreKey = nextLoadMoreKey;
      if (pageCount === input.maxPages) historyEnd = 'limit';
    }
    if (input.shouldStop?.()) throw new Error('CANCELLED');
    return { ok: true as const, scannedItems, pages: pageCount, reachedBoundary, historyEnd };
  } catch (error) {
    return { ...feedFailure(error), scannedItems, pages: pageCount, reachedBoundary };
  }
}
