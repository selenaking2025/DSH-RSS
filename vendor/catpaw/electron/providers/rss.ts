import type { RssHistoryCursor } from '../contracts/rss-history';
import { chooseFeedSiteUrl, resolveNextPageUrl, saveRssItems } from './rss-page';
import { createRssFetchPlan } from './adapters/rss-plan';
import type { RssFetchOptions } from './rss-options';
import { fetchRssPage, markHostSuccess, isHostCoolingDown, REFRESH_TOTAL_TIMEOUT_MS, REFRESH_MAX_FIRST_PAGE_SEEDS } from './rss-fetch-policy';
import type { FeedSyncTarget } from '../data/feed-sync-repo';
import type { FeedRunResult } from '../contracts/feed-run';
import { classifyFeedError, feedFailure } from '../feed-errors';
import { dedupeUrls } from '../sources/source-url-utils';
import { backfillXiaoyuzhouByApi } from './adapters/xiaoyuzhou-history';
import { withRequestBudget } from '../network/http';
export { fetchWithTimeout } from '../network/http';
import Parser from 'rss-parser';
import { createHash } from 'node:crypto';
import { listFeeds } from '../data/feed-repo';
import {
  getFeedFetchMetaByUrl,
  resolveFeedForSync,
  updateFeedContentType,
  updateFeedHistorySyncedAt,
  updateFeedSourceType,
  updateFeedFetchMeta,
} from '../data/feed-write-repo';
import { detectFeedContentType, detectFeedSourceType } from '../sources/content-type';
import {
  extractXiaoyuzhouPodcastIdFromUrl,
  isWeChat2RssFeedUrl,
} from '../sources/rsshub';

const parser = new Parser({
  customFields: {
    item: [
      'content:encoded',
      'content',
      'summary',
      ['media:content', 'media:content', { keepArray: true }],
      ['media:thumbnail', 'media:thumbnail'],
    ],
  },
});

const HISTORY_START_AT = new Date(2023, 0, 1).getTime();
const CONDITIONAL_RESET_MS = 8 * 24 * 60 * 60 * 1000;
const MAX_BACKFILL_PAGES = 300;

function normalizeBackfillMaxPages(input?: number | null) {
  if (!input || Number.isNaN(input)) return MAX_BACKFILL_PAGES;
  const value = Math.floor(input);
  return Math.min(300, Math.max(1, value));
}

export async function refreshFeed(url: string, meta?: RssFetchOptions) {
  return withRequestBudget({
    deadlineAt: Date.now() + (meta?.backfill ? 30 * 60_000 : REFRESH_TOTAL_TIMEOUT_MS),
    shouldStop: meta?.shouldStop,
  }, () => refreshFeedWithinBudget(url, meta));
}

async function refreshFeedWithinBudget(
  url: string,
  meta?: RssFetchOptions,
): Promise<FeedRunResult & { feedId: string | null; backfilled?: boolean; historyContinuation?: RssHistoryCursor }> {
  const existing = getFeedFetchMetaByUrl(url);
  let syncTarget = meta?.syncTarget ?? (existing ? { id: existing.id, url: existing.url, revision: existing.syncRevision } : undefined);
  const now = Date.now();
  const isBackfill = Boolean(meta?.backfill);
  const backfillUntil = meta?.backfillUntil ?? HISTORY_START_AT;
  const maxBackfillPages = normalizeBackfillMaxPages(meta?.maxBackfillPages);
  const xiaoyuzhouPodcastId = extractXiaoyuzhouPodcastIdFromUrl(url) ?? extractXiaoyuzhouPodcastIdFromUrl(meta?.siteUrl ?? null);

  let etag = existing?.etag ?? null;
  let lastModified = existing?.lastModified ?? null;
  let contentHash = existing?.contentHash ?? null;
  let conditionalGetAt = existing?.conditionalGetAt ?? null;

  if (conditionalGetAt && now - conditionalGetAt > CONDITIONAL_RESET_MS) {
    etag = null;
    lastModified = null;
    conditionalGetAt = null;
  }

  let nativeFailure: string | null = null;
  if (isBackfill && xiaoyuzhouPodcastId && meta?.useNativeHistoryApi !== false) {
    const sourceType = detectFeedSourceType(url, meta?.siteUrl ?? null);
    syncTarget = resolveFeedForSync({ title: meta?.title, url, siteUrl: meta?.siteUrl,
      groupId: meta?.groupId, sourceType }, syncTarget);
    updateFeedContentType(syncTarget.id, detectFeedContentType(url, meta?.siteUrl ?? null), syncTarget);
    updateFeedSourceType(syncTarget.id, sourceType, syncTarget);
    const native = await backfillXiaoyuzhouByApi({ podcastId: xiaoyuzhouPodcastId,
      feedId: syncTarget.id, syncTarget, backfillUntil: 0, maxPages: maxBackfillPages,
      shouldStop: meta?.shouldStop });
    if (native.ok) {
      updateFeedFetchMeta(syncTarget.id, { lastCheckedAt: now }, syncTarget);
      updateFeedHistorySyncedAt(syncTarget.id, now, syncTarget);
      return { ...native, feedId: syncTarget.id, backfilled: true };
    }
    if (meta?.endpointManaged || native.pages > 0 || native.scannedItems > 0 ||
        (native.errorKind !== 'provider' && native.errorKind !== 'timeout')) {
      return { ...native, feedId: syncTarget.id };
    }
    nativeFailure = `xiaoyuzhou-api -> ${native.error}`;
  }

  const cursor = meta?.historyCursor;
  const { pendingSeedUrls, sourceRsshubBase } = cursor
    ? { pendingSeedUrls: [...cursor.pendingSeedUrls], sourceRsshubBase: cursor.sourceRsshubBase }
    : await createRssFetchPlan(url, meta, existing?.id);
  let pageUrl: string | null = cursor?.nextUrl ?? pendingSeedUrls.shift() ?? null;
  let pageCount = cursor?.pages ?? 0;
  const stepStartPage = pageCount;
  let scannedItems = cursor?.scannedItems ?? 0;
  let reachedBackfillBoundary = cursor?.reachedBoundary ?? false;
  let historyEnd: 'end' | 'limit' | 'boundary' = 'end';
  let firstPageHash: string | null = null;
  let firstPageEtag: string | null = null;
  let firstPageLastModified: string | null = null;
  let firstPageUrl: string | null = null;
  let feedId: string | null = cursor ? syncTarget?.id ?? null : null;
  const cancelledResult = (): FeedRunResult & { feedId: string | null } => ({ ...feedFailure('CANCELLED', 'cancelled'), feedId,
    pages: pageCount, scannedItems });
  const visited = new Set<string>(cursor?.visited);
  const firstPageFailures: string[] = [];
  const refreshStartedAt = Date.now();
  let attemptedFirstPageSeeds = pageUrl ? 1 : 0;
  const buildJoinedFailures = () => dedupeUrls([...firstPageFailures, nativeFailure]).join(' | ');
  const takeNextFirstPageSeedUrl = (currentPageUrl: string) => {
    while (pendingSeedUrls.length > 0) {
      if (attemptedFirstPageSeeds >= REFRESH_MAX_FIRST_PAGE_SEEDS) {
        return null;
      }
      const candidate = pendingSeedUrls.shift() ?? null;
      if (!candidate || candidate === currentPageUrl) continue;
      attemptedFirstPageSeeds += 1;
      if (isHostCoolingDown(candidate)) {
        firstPageFailures.push(`${candidate} -> HOST_COOLDOWN`);
        continue;
      }
      return candidate;
    }
    return null;
  };


  while (pageUrl && pageCount < (isBackfill ? maxBackfillPages : 1)) {
    if (meta?.shouldStop?.()) return cancelledResult();
    if (visited.has(pageUrl)) break;
    visited.add(pageUrl);
    const currentPageUrl = pageUrl;
    const cacheMatches = !isBackfill && existing?.fetchMetaUrl === currentPageUrl;
    const headers: Record<string, string> = {};
    if (cacheMatches && pageCount === 0) {
      if (etag) headers['If-None-Match'] = etag;
      if (lastModified) headers['If-Modified-Since'] = lastModified;
    }

    if (pageCount === 0) {
      if (!isBackfill && Date.now() - refreshStartedAt > REFRESH_TOTAL_TIMEOUT_MS) {
        firstPageFailures.push(`refresh-budget -> ${REFRESH_TOTAL_TIMEOUT_MS}ms exceeded`);
        const joinedFailures = buildJoinedFailures();
        throw new Error(joinedFailures ? `FEED_FETCH_TIMEOUT: ${joinedFailures}` : 'FEED_FETCH_TIMEOUT');
      }
      // Backfill used to record host failures but never consult the cooldown they
      // armed, so a host that refresh had already backed off from could still be
      // walked for hundreds of pages.
      if (isHostCoolingDown(currentPageUrl)) {
        firstPageFailures.push(`${currentPageUrl} -> HOST_COOLDOWN`);
        const nextSeed = isBackfill ? (pendingSeedUrls.shift() ?? null) : takeNextFirstPageSeedUrl(currentPageUrl);
        if (nextSeed && nextSeed !== currentPageUrl) {
          pageUrl = nextSeed;
          continue;
        }
        const joinedFailures = buildJoinedFailures();
        throw new Error(joinedFailures ? `FEED_FETCH_TIMEOUT: ${joinedFailures}` : 'FEED_FETCH_TIMEOUT');
      }
    }

    let response: Response;
    try {
      response = await fetchRssPage(currentPageUrl, headers, isBackfill, !isBackfill && pageCount === 0);
    } catch (error) {
      const kind = classifyFeedError(error);
      if (kind === 'cancelled') return cancelledResult();
      if (kind !== 'provider' && kind !== 'timeout') throw error;
      if (pageCount > 0) return { ...feedFailure(error), feedId, pages: pageCount, scannedItems, reachedBoundary: reachedBackfillBoundary };
      firstPageFailures.push(`${currentPageUrl} -> ${error instanceof Error ? error.message : String(error)}`);
      const nextSeed = isBackfill ? (pendingSeedUrls.shift() ?? null) : takeNextFirstPageSeedUrl(currentPageUrl);
      if (nextSeed && nextSeed !== currentPageUrl) { pageUrl = nextSeed; continue; }
      const failures = buildJoinedFailures();
      throw new Error(error instanceof Error && error.name === 'AbortError' ? `FEED_FETCH_TIMEOUT: ${failures}` : failures);
    }

    if (pageCount === 0 && response.status === 304) {
      if (!cacheMatches || (!etag && !lastModified)) throw new Error('UNEXPECTED_NOT_MODIFIED');
      markHostSuccess(currentPageUrl);
      if (!existing) {
        return { ok: false, error: 'NOT_MODIFIED' as const, feedId: null };
      }
      const responseEtag = response.headers.get('etag');
      const responseLastModified = response.headers.get('last-modified');
      const nextEtag = responseEtag ?? etag;
      const nextLastModified = responseLastModified ?? lastModified;
      const nextConditionalAt = nextEtag || nextLastModified ? now : null;
      updateFeedFetchMeta(existing.id, {
        lastCheckedAt: now,
        etag: nextEtag,
        lastModified: nextLastModified,
        contentHash,
        conditionalGetAt: nextConditionalAt,
        fetchMetaUrl: currentPageUrl,
      }, syncTarget);
      return { ok: true, notModified: true, feedId: existing.id };
    }

    markHostSuccess(currentPageUrl);

    const xml = await response.text();
    if (pageCount === 0) {
      firstPageHash = createHash('md5').update(xml).digest('hex');
      firstPageUrl = currentPageUrl;
      firstPageEtag = response.headers.get('etag') ?? null;
      firstPageLastModified = response.headers.get('last-modified') ?? null;

      if (cacheMatches && existing && contentHash && firstPageHash === contentHash) {
        const nextConditionalAt = firstPageEtag || firstPageLastModified ? now : null;
        updateFeedFetchMeta(existing.id, {
          lastCheckedAt: now,
          etag: firstPageEtag,
          lastModified: firstPageLastModified,
          contentHash,
          conditionalGetAt: nextConditionalAt,
          fetchMetaUrl: currentPageUrl,
        }, syncTarget);
        return { ok: true, notModified: true, feedId: existing.id };
      }
    }

    const parsed = await parser.parseString(xml);
    if (!feedId) {
      const feedSiteUrl = chooseFeedSiteUrl(meta?.siteUrl ?? null, parsed.link ?? null, url);
      syncTarget = resolveFeedForSync({
        title: meta?.title ?? parsed.title ?? null,
        url,
        siteUrl: feedSiteUrl,
        groupId: meta?.groupId,
        sourceType: detectFeedSourceType(url, feedSiteUrl),
      }, syncTarget);
      feedId = syncTarget.id;
      const detectedType = detectFeedContentType(url, feedSiteUrl);
      const detectedSourceType = detectFeedSourceType(url, feedSiteUrl);
      updateFeedContentType(feedId, detectedType, syncTarget);
      updateFeedSourceType(feedId, detectedSourceType, syncTarget);
    }

    const { scannedItems: saved, pageHasRecentItems, pageHasOlderItems, sourceFallbackBackfillUrl } =
      await saveRssItems(parsed.items ?? [], feedId, syncTarget!, backfillUntil, sourceRsshubBase);
    scannedItems += saved;

    if (pageHasOlderItems) {
      reachedBackfillBoundary = true;
    }

    pageCount += 1;
    if (!isBackfill) break;
    if (pageHasOlderItems && !pageHasRecentItems) { historyEnd = 'boundary'; break; }
    const nextPageUrl = resolveNextPageUrl(currentPageUrl, xml, response);
    if (!meta?.endpointManaged && !nextPageUrl && isWeChat2RssFeedUrl(pageUrl) && sourceFallbackBackfillUrl && !visited.has(sourceFallbackBackfillUrl)) {
      pageUrl = sourceFallbackBackfillUrl;
      continue;
    }
    pageUrl = nextPageUrl ?? pendingSeedUrls.shift() ?? null;
    if (meta?.shouldStop?.()) return cancelledResult();
    if (pageUrl && !visited.has(pageUrl) && pageCount < maxBackfillPages && meta?.historyStepPages
      && pageCount - stepStartPage >= meta.historyStepPages) {
      return { ok: true, feedId, pages: pageCount, scannedItems, historyContinuation: {
        nextUrl: pageUrl, pendingSeedUrls, visited: [...visited], pages: pageCount, scannedItems, sourceRsshubBase,
        reachedBoundary: reachedBackfillBoundary,
      } };
    }
  }

  if (meta?.shouldStop?.()) return cancelledResult();
  if (!feedId) {
    throw new Error('FEED_PARSE_FAILED');
  }

  if (isBackfill) {
    if (historyEnd !== 'boundary' && pageUrl && pageCount >= maxBackfillPages) historyEnd = 'limit';
    // A backfill usually enters through a mirror/bridge URL that regular refreshes
    // never poll, so its ETag/Last-Modified/body hash describe a different resource
    // and must not become this feed's conditional-GET state.
    updateFeedFetchMeta(feedId, { lastCheckedAt: now }, syncTarget);
    updateFeedHistorySyncedAt(feedId, now, syncTarget);
    return { ok: true, feedId, backfilled: true, historyEnd, pages: pageCount, scannedItems, reachedBoundary: reachedBackfillBoundary };
  }

  const nextConditionalAt = firstPageEtag || firstPageLastModified ? now : null;
  updateFeedFetchMeta(feedId, {
    lastCheckedAt: now,
    etag: firstPageEtag,
    lastModified: firstPageLastModified,
    contentHash: firstPageHash,
    conditionalGetAt: nextConditionalAt,
    fetchMetaUrl: firstPageUrl,
  }, syncTarget);

  return { ok: true, feedId };
}

export async function backfillFeedById(
  feedId: string,
  options?: {
    syncTarget?: FeedSyncTarget;
    historyCursor?: RssHistoryCursor;
    historyStepPages?: number;
    since?: number | null;
    maxPages?: number | null;
    fetchUrl?: string | null;
    endpointManaged?: boolean;
    useNativeHistoryApi?: boolean;
    shouldStop?: () => boolean;
  },
) {
  const feeds = listFeeds();
  const feed = feeds.find((item) => item.id === feedId);
  if (!feed) return { ok: false, error: 'FEED_NOT_FOUND' as const };
  const isXiaoyuzhou = Boolean(
    extractXiaoyuzhouPodcastIdFromUrl(feed.url) ??
    extractXiaoyuzhouPodcastIdFromUrl(feed.siteUrl ?? null),
  );
  const defaultSince = isXiaoyuzhou ? 0 : HISTORY_START_AT;
  return await refreshFeed(feed.url, {
    syncTarget: options?.syncTarget ?? { id: feed.id, url: feed.url, revision: feed.syncRevision },
    title: feed.title ?? null,
    groupId: feed.groupId ?? null,
    siteUrl: feed.siteUrl ?? null,
    fetchUrl: options?.fetchUrl ?? null,
    endpointManaged: options?.endpointManaged,
    useNativeHistoryApi: options?.useNativeHistoryApi,
    historyCursor: options?.historyCursor,
    historyStepPages: options?.historyStepPages,
    backfill: true,
    backfillUntil: options?.since ?? defaultSince,
    maxBackfillPages: options?.maxPages ?? MAX_BACKFILL_PAGES,
    shouldStop: options?.shouldStop,
  });
}
