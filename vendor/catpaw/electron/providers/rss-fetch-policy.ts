import { fetchWithTimeout } from '../network/http';
import { classifyFeedError } from '../feed-errors';

function readPositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const FEED_FETCH_TIMEOUT_MS = readPositiveIntegerEnv('CATPAW_FEED_FETCH_TIMEOUT_MS', 20_000);
const REFRESH_FEED_FETCH_TIMEOUT_MS = readPositiveIntegerEnv('CATPAW_REFRESH_FEED_FETCH_TIMEOUT_MS', 12_000);
const BRIDGE_REFRESH_FEED_FETCH_TIMEOUT_MS = readPositiveIntegerEnv('CATPAW_BRIDGE_REFRESH_FEED_FETCH_TIMEOUT_MS', 12_000);
const BRIDGE_BACKFILL_FEED_FETCH_TIMEOUT_MS = readPositiveIntegerEnv('CATPAW_BRIDGE_BACKFILL_FEED_FETCH_TIMEOUT_MS', 20_000);
export const REFRESH_MAX_FIRST_PAGE_SEEDS = 2;
export const REFRESH_TOTAL_TIMEOUT_MS = readPositiveIntegerEnv('CATPAW_REFRESH_TOTAL_TIMEOUT_MS', 25_000);
const HOST_FAILURE_THRESHOLD = 3;
const BRIDGE_HOST_FAILURE_THRESHOLD = 5;
const HOST_FAILURE_WINDOW_MS = 120_000;
const HOST_COOLDOWN_MS = 120_000;
const BRIDGE_HOST_COOLDOWN_MS = 60_000;
const hostFailureState = new Map<string, { count: number; firstFailedAt: number; cooldownUntil: number }>();
function hostFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function isBridgeFetchHost(url: string) {
  const host = hostFromUrl(url) ?? '';
  return host.includes('wechat2rss') || host.includes('rsshub') || host.includes('bestblogs.dev');
}

function shouldCountHostFailureFromStatus(status: number) {
  return status >= 500 || status === 429 || status === 408;
}

function shouldCountHostFailureFromError(error: unknown) {
  const kind = classifyFeedError(error);
  if (kind !== 'provider' && kind !== 'timeout') return false;
  if (!error || typeof error !== 'object') return true;
  if ('name' in error && (error as { name?: string }).name === 'AbortError') return true;
  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    const message = ((error as { message: string }).message ?? '').toLowerCase();
    if (
      message.includes('fetch failed') ||
      message.includes('timed out') ||
      message.includes('aborted') ||
      message.includes('network') ||
      message.includes('socket') ||
      message.includes('econn') ||
      message.includes('enotfound')
    ) {
      return true;
    }
  }
  return false;
}

export function markHostSuccess(url: string) {
  const host = hostFromUrl(url);
  if (!host) return;
  hostFailureState.delete(host);
}

function markHostFailure(url: string) {
  const host = hostFromUrl(url);
  if (!host) return;
  const now = Date.now();
  const failureThreshold = isBridgeFetchHost(url) ? BRIDGE_HOST_FAILURE_THRESHOLD : HOST_FAILURE_THRESHOLD;
  const cooldownMs = isBridgeFetchHost(url) ? BRIDGE_HOST_COOLDOWN_MS : HOST_COOLDOWN_MS;
  const existing = hostFailureState.get(host);
  if (!existing || now - existing.firstFailedAt > HOST_FAILURE_WINDOW_MS) {
    hostFailureState.set(host, {
      count: 1,
      firstFailedAt: now,
      cooldownUntil: 0,
    });
    return;
  }

  const nextCount = existing.count + 1;
  const nextState = {
    count: nextCount,
    firstFailedAt: existing.firstFailedAt,
    cooldownUntil: nextCount >= failureThreshold ? now + cooldownMs : existing.cooldownUntil,
  };
  hostFailureState.set(host, nextState);
}

export function isHostCoolingDown(url: string) {
  const host = hostFromUrl(url);
  if (!host) return false;
  const state = hostFailureState.get(host);
  if (!state) return false;
  const now = Date.now();
  if (state.cooldownUntil > now) return true;
  if (state.cooldownUntil > 0 && state.cooldownUntil <= now) {
    hostFailureState.delete(host);
  }
  return false;
}

function resolveFeedFetchTimeoutMs(url: string, options?: { backfill?: boolean }) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('wechat2rss') || host.includes('rsshub') || host.includes('bestblogs.dev')) {
      return options?.backfill
        ? BRIDGE_BACKFILL_FEED_FETCH_TIMEOUT_MS
        : BRIDGE_REFRESH_FEED_FETCH_TIMEOUT_MS;
    }
    if (!options?.backfill) {
      return REFRESH_FEED_FETCH_TIMEOUT_MS;
    }
  } catch {
    // Use default timeout on parse errors.
  }
  return options?.backfill ? FEED_FETCH_TIMEOUT_MS : REFRESH_FEED_FETCH_TIMEOUT_MS;
}

function resolveRefreshRetryFetchTimeoutMs(url: string) {
  const firstAttemptTimeout = resolveFeedFetchTimeoutMs(url, { backfill: false });
  if (isBridgeFetchHost(url)) {
    return Math.max(BRIDGE_BACKFILL_FEED_FETCH_TIMEOUT_MS, firstAttemptTimeout);
  }
  return Math.max(FEED_FETCH_TIMEOUT_MS, firstAttemptTimeout);
}

function shouldRetryRefreshFirstPageError(error: unknown) {
  if (!['provider', 'timeout'].includes(classifyFeedError(error))) return false;
  if (!error || typeof error !== 'object') {
    return false;
  }

  if ('name' in error && (error as { name?: string }).name === 'AbortError') {
    return true;
  }

  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    const message = ((error as { message: string }).message ?? '').toLowerCase();
    return (
      message.includes('timeout')
      || message.includes('timed out')
      || message.includes('fetch failed')
      || message.includes('network')
      || message.includes('socket')
      || message.includes('econn')
      || message.includes('enotfound')
      || message.includes('tls')
      || message.includes('aborted')
    );
  }

  return false;
}

export async function fetchRssPage(url: string, headers: Record<string, string>, backfill: boolean, retry: boolean) {
  const fetch = (timeout: number) => fetchWithTimeout(url, { headers }, timeout);
  let response: Response;
  try {
    try { response = await fetch(resolveFeedFetchTimeoutMs(url, { backfill })); }
    catch (error) {
      if (!retry || !shouldRetryRefreshFirstPageError(error)) throw error;
      response = await fetch(resolveRefreshRetryFetchTimeoutMs(url));
    }
  } catch (error) {
    if (shouldCountHostFailureFromError(error)) markHostFailure(url);
    throw error;
  }
  if (!response.ok && response.status !== 304) {
    if (shouldCountHostFailureFromStatus(response.status)) markHostFailure(url);
    throw new Error(`HTTP ${response.status}`);
  }
  return response;
}
