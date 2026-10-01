import type { Feed } from './reader';
import type { FeedJobResult, RssWorkerMessage, RssWorkerProgress, RssWorkerRequest } from './rss-jobs';

type PayloadMessage = Extract<RssWorkerMessage, { type: 'progress' | 'result' | 'yielded' }>;
type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32_768;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const optional = (value: unknown, rule: (value: unknown) => boolean) => value === undefined || rule(value);
const nullable = (value: unknown, rule: (value: unknown) => boolean) => value === null || rule(value);
const boolean = (value: unknown) => typeof value === 'boolean';
const httpUrl = (value: unknown) => {
  if (!text(value)) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};
function requireValid(valid: unknown, detail: string): asserts valid {
  if (!valid) throw new Error(`RSS_INVALID_MESSAGE:${detail}`);
}
function validFeed(value: unknown): value is Feed {
  if (!object(value) || !text(value.id) || !text(value.url) || !count(value.syncRevision) || ![0, 1].includes(value.enabled as number)) return false;
  return ['title', 'siteUrl', 'groupId', 'contentType', 'sourceType', 'lastModified', 'etag', 'contentHash']
    .every((key) => nullable(value[key], (value) => typeof value === 'string'))
    && ['historySyncedAt', 'lastCheckedAt', 'conditionalGetAt', 'fetchIntervalMinutes', 'nextRefreshAt']
      .every((key) => nullable(value[key], count));
}
function validFeedResult(value: unknown): value is FeedJobResult {
  if (!object(value) || !text(value.id) || !text(value.url) || !boolean(value.ok)) return false;
  return ['cancelled', 'reachedBoundary', 'historyCapable', 'notModified'].every((key) => optional(value[key], boolean))
    && ['newEntries', 'pages', 'scannedItems'].every((key) => optional(value[key], count))
    && optional(value.error, (value) => typeof value === 'string')
    && optional(value.resolvedFeedId, text) && optional(value.endpointId, (value) => nullable(value, text))
    && optional(value.historyEnd, (value) => ['end', 'limit', 'boundary'].includes(value as string))
    && optional(value.errorKind, (value) => ['cancelled', 'timeout', 'provider', 'storage', 'source-changed', 'internal'].includes(value as string));
}

/** Return null for an older request; malformed messages from the current child fail it. */
export function parseRssWorkerPayload(input: unknown, request: RssWorkerRequest, previous: RssWorkerProgress | null): PayloadMessage | null {
  requireValid(object(input) && ['progress', 'result', 'yielded'].includes(input.type as string) && object(input.payload), 'envelope');
  const payload = input.payload;
  const progress = input.type === 'yielded' ? payload.progress : payload;
  requireValid(object(progress) && text(progress.requestId), 'request');
  if (progress.requestId !== request.requestId) return null;
  requireValid(progress.kind === request.kind && progress.trigger === request.trigger, 'job identity');
  const keys = ['totalFeeds', 'feedsCompleted', 'feedsSucceeded', 'feedsFailed', 'newEntries'] as const;
  requireValid(keys.every((key) => count(progress[key])), 'counters');
  const p = progress as RssWorkerProgress;
  requireValid(typeof p.runId === 'string' && (p.runId.length > 0 || (input.type === 'result' && p.feedsCompleted === 0 && text(payload.error))), 'run id');
  requireValid(p.feedsCompleted <= p.totalFeeds && p.feedsSucceeded + p.feedsFailed === p.feedsCompleted, 'counter totals');
  requireValid(optional(p.currentFeedId, text) && optional(p.currentFeedUrl, text), 'current feed');
  if (previous) requireValid(p.runId === previous.runId && p.totalFeeds === previous.totalFeeds
    && keys.slice(1).every((key) => p[key] >= previous[key]), 'progress regression');
  if (request.kind.endsWith('_feed') || request.kind === 'refresh_url') requireValid(p.totalFeeds <= 1, 'single feed total');
  const allowedIds = request.feedId ? new Set([request.feedId]) : request.options?.feedIds ? new Set(request.options.feedIds) : null;
  if (allowedIds) requireValid(p.totalFeeds <= allowedIds.size, 'requested feed total');
  if (input.type === 'progress') return input as PayloadMessage;

  requireValid(Array.isArray(payload.results) && payload.results.length === p.feedsCompleted && payload.results.every(validFeedResult), 'feed results');
  const results = payload.results as FeedJobResult[];
  const ids = new Set(results.map((result) => result.id));
  requireValid(ids.size === results.length && (!allowedIds || results.every((result) => allowedIds.has(result.id))), 'feed ownership');
  requireValid(results.filter((result) => result.ok).length === p.feedsSucceeded
    && results.reduce((total, result) => total + (result.newEntries ?? 0), 0) === p.newEntries, 'result totals');
  requireValid(optional(payload.followUpBackfillFeedIds, (value) => Array.isArray(value) && value.every((id) => text(id)
    && results.some((result) => result.id === id && result.ok))), 'follow ups');
  if (input.type === 'yielded') {
    requireValid(Array.isArray(payload.remainingFeeds) && payload.remainingFeeds.length === p.totalFeeds - p.feedsCompleted
      && payload.remainingFeeds.length > 0 && payload.remainingFeeds.every(validFeed), 'continuation');
    const remaining = payload.remainingFeeds as Feed[];
    requireValid(new Set(remaining.map((feed) => feed.id)).size === remaining.length
      && remaining.every((feed) => !ids.has(feed.id) && (!allowedIds || allowedIds.has(feed.id))), 'continuation ownership');
    requireValid(Array.isArray(payload.followUpBackfillFeedIds), 'continuation follow ups');
    const pending = payload.pendingHistory;
    const before = request.continuation?.pendingHistory;
    if (pending !== undefined) {
      requireValid(request.kind.startsWith('backfill') && object(pending) && pending.feedId === remaining[0].id
        && count(pending.startedAt) && count(pending.newEntries) && object(pending.cursor) && object(pending.endpoint), 'history owner');
      const cursor = pending.cursor, endpoint = pending.endpoint;
      const urls = (value: unknown) => Array.isArray(value) && value.length <= 300 && value.every(httpUrl);
      requireValid(httpUrl(cursor.nextUrl) && urls(cursor.pendingSeedUrls) && urls(cursor.visited)
        && count(cursor.pages) && cursor.pages > 0 && cursor.pages < 300 && count(cursor.scannedItems)
        && boolean(cursor.reachedBoundary)
        && nullable(cursor.sourceRsshubBase, httpUrl)
        && !(cursor.visited as string[]).includes(cursor.nextUrl as string), 'history cursor');
      requireValid(endpoint.feedId === pending.feedId && ['endpointId', 'sourceId', 'providerType'].every((key) => text(endpoint[key]))
        && httpUrl(endpoint.endpointUrl) && nullable(endpoint.endpointHost, text)
        && ['primary', 'fallback'].includes(endpoint.endpointRole as string)
        && ['native', 'bridge', 'adapter', 'unknown'].includes(endpoint.providerClass as string)
        && ['active', 'degraded', 'cooldown'].includes(endpoint.endpointStatus as string)
        && ['system', 'user'].includes(endpoint.managedBy as string) && count(endpoint.roleLocked)
        && nullable(endpoint.cooldownUntil, count) && nullable(endpoint.lastError, (value) => typeof value === 'string'), 'history endpoint');
      if (before) requireValid(pending.feedId === before.feedId && pending.startedAt === before.startedAt
        && pending.newEntries >= before.newEntries && cursor.pages > before.cursor.pages && cursor.scannedItems >= before.cursor.scannedItems
        && endpoint.endpointId === before.endpoint.endpointId && endpoint.endpointUrl === before.endpoint.endpointUrl
        && remaining[0].syncRevision === request.continuation!.remainingFeeds[0].syncRevision
        && remaining[0].url === request.continuation!.remainingFeeds[0].url, 'history regression');
    }
    requireValid(p.feedsCompleted > (request.continuation?.progress.feedsCompleted ?? 0)
      || (object(pending) && object(pending.cursor) && (pending.cursor.pages as number) > (before?.cursor.pages ?? 0)), 'continuation must advance');
  } else {
    requireValid(optional(payload.cancelled, boolean) && optional(payload.error, (value) => typeof value === 'string'), 'terminal state');
    requireValid(payload.cancelled || payload.error || p.feedsCompleted === p.totalFeeds, 'incomplete terminal');
    requireValid(!(payload.cancelled || payload.error) || !payload.followUpBackfillFeedIds || (payload.followUpBackfillFeedIds as string[]).length === 0, 'terminal follow ups');
  }
  return input as PayloadMessage;
}
