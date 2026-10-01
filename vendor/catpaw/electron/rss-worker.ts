import { runFeedBatch } from './services/feed-batch';
import { initializeReaderData } from './services/initialize-reader-data';
import { affectsEndpointHealth } from './feed-errors';
import { executeSourceAdapter, type BackfillHandlers, type EndpointAttemptResult } from './providers/adapters/registry';
import { withRequestBudget } from './network/http';
import type { Feed, RefreshEndpointCandidate } from './data/db-types';
import { countEntries } from './data/entry-read-repo';
import { listFeeds } from './data/feed-repo';
import { createPipelineRun, updatePipelineRun } from './data/pipeline-run-repo';
import { createFeedRunResult, listRefreshEndpointsForFeed } from './data/source-endpoint-repo';
import type {
  FeedJobResult,
  RssBatchJobOptions,
  RssJobKind,
  RssWorkerCancelMessage,
  RssWorkerInboundMessage,
  RssWorkerMessage,
  RssWorkerProgress,
  RssWorkerRequest,
  RssWorkerResult,
  RssWorkerCheckpoint,
  PendingRssHistory,
} from './contracts/rss-jobs';

const DEFAULT_REFRESH_CONCURRENCY = 6;
const DEFAULT_BACKFILL_CONCURRENCY = 1;
const DEFAULT_PER_HOST_CONCURRENCY = 1;
const AUTO_ONE_TIME_HISTORY_BACKFILL = process.env.CATPAW_AUTO_HISTORY_BACKFILL === '1';

type QueueFeed = Feed & {
  hostKey: string;
};


type EndpointFeedExecutionResult = FeedJobResult & {
  attempts: EndpointAttemptResult[];
  pendingHistory?: PendingRssHistory;
};

function isEndpointFeedExecutionResult(result: FeedJobResult | EndpointFeedExecutionResult): result is EndpointFeedExecutionResult {
  return Array.isArray((result as EndpointFeedExecutionResult).attempts);
}

// A batch keeps running after cancellation is requested only for as long as it
// takes the current page/feed to unwind, so partial work stays committed and the
// worker process survives to serve the next job.
const cancelledRequestIds = new Set<string>();
let activeProgress: RssWorkerProgress | null = null;
let activeResults: FeedJobResult[] = [];

function isCancelled(requestId: string) {
  return cancelledRequestIds.has(requestId);
}

function isCancelMessage(message: RssWorkerInboundMessage): message is RssWorkerCancelMessage {
  return 'type' in message && message.type === 'cancel';
}

function postMessage(message: RssWorkerMessage) {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

function getHostKey(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'unknown-host';
  }
}

function pickFeedsForRequest(request: RssWorkerRequest) {
  const hasExplicitFeedIds = Array.isArray(request.options?.feedIds);
  const byId = new Set((request.options?.feedIds ?? []).filter(Boolean));
  const feeds = listFeeds();
  const selected = hasExplicitFeedIds
    ? feeds.filter((feed) => byId.has(feed.id))
    : feeds.filter((feed) => feed.enabled !== 0);
  return selected.map((feed) => ({
    ...feed,
    hostKey: getHostKey(feed.url),
  }));
}

function createVirtualFeedFromRefreshInput(request: RssWorkerRequest): QueueFeed | null {
  const input = request.refreshInput;
  if (!input?.url) return null;
  return {
    id: request.feedId ?? input.url,
    syncRevision: 0,
    title: input.title ?? null,
    url: input.url,
    siteUrl: input.siteUrl ?? null,
    groupId: input.groupId ?? null,
    contentType: null,
    sourceType: null,
    historySyncedAt: null,
    lastCheckedAt: null,
    lastModified: null,
    etag: null,
    contentHash: null,
    conditionalGetAt: null,
    enabled: 1,
    fetchIntervalMinutes: null,
    nextRefreshAt: null,
    hostKey: getHostKey(input.url),
  };
}

function createProgressBase(request: RssWorkerRequest, runId: string, totalFeeds: number): RssWorkerProgress {
  return {
    requestId: request.requestId,
    runId,
    kind: request.kind,
    trigger: request.trigger,
    totalFeeds,
    feedsCompleted: 0,
    feedsSucceeded: 0,
    feedsFailed: 0,
    newEntries: 0,
  };
}

async function refreshViaEndpoint(feed: QueueFeed, endpoint: RefreshEndpointCandidate | null,
  request: RssWorkerRequest, feedStartedAt: number): Promise<EndpointAttemptResult> {
  return executeSourceAdapter({ mode: 'refresh', feed, endpoint, allowCreate: request.kind === 'refresh_url', startedAt: feedStartedAt,
    shouldStop: () => isCancelled(request.requestId) });
}

async function refreshOneFeed(feed: QueueFeed, request: RssWorkerRequest): Promise<EndpointFeedExecutionResult> {
  const budget = Number(process.env.CATPAW_REFRESH_TOTAL_TIMEOUT_MS) || 25_000;
  return withRequestBudget({ deadlineAt: Date.now() + budget }, () => refreshOneFeedWithinBudget(feed, request));
}

async function refreshOneFeedWithinBudget(feed: QueueFeed, request: RssWorkerRequest): Promise<EndpointFeedExecutionResult> {
  const startedAt = Date.now();
  const endpoints = request.kind === 'refresh_url'
    ? []
    : listRefreshEndpointsForFeed(feed.id);
  const attempts: EndpointAttemptResult[] = [];

  if (endpoints.length === 0 && request.kind !== 'refresh_url') {
    return {
      id: feed.id,
      url: feed.url,
      ok: false,
      resolvedFeedId: feed.id,
      error: 'SOURCE_ENDPOINTS_COOLDOWN',
      newEntries: 0,
      attempts: [],
    };
  }

  if (request.kind === 'refresh_url') {
    const attempt = await refreshViaEndpoint(feed, null, request, startedAt);
    attempts.push(attempt);
  } else {
    for (const endpoint of endpoints) {
      const attempt = await refreshViaEndpoint(feed, endpoint, request, startedAt);
      attempts.push(attempt);
      if (attempt.ok || !affectsEndpointHealth(attempt.errorKind) || isCancelled(request.requestId)) {
        break;
      }
    }
  }

  const finalAttempt = attempts[attempts.length - 1];
  return {
    id: finalAttempt?.resolvedFeedId ?? feed.id,
    url: feed.url,
    endpointId: finalAttempt?.endpointId ?? null,
    ok: Boolean(finalAttempt?.ok),
    resolvedFeedId: finalAttempt?.resolvedFeedId ?? feed.id,
    error: finalAttempt?.error,
    errorKind: finalAttempt?.errorKind,
    cancelled: finalAttempt?.cancelled,
    notModified: finalAttempt?.notModified,
    newEntries: finalAttempt?.newEntries ?? 0,
    attempts,
  };
}

function pickBackfillEndpoints(endpoints: RefreshEndpointCandidate[]) {
  const backfillCapableEndpoints = endpoints.filter((endpoint) => endpoint.providerType !== 'x-api-twitter');
  const webCliEndpoints = backfillCapableEndpoints.filter((endpoint) => endpoint.providerType === 'web-cli-twitter');
  if (webCliEndpoints.length > 0) {
    return webCliEndpoints;
  }
  return backfillCapableEndpoints;
}

/**
 * The provider handlers a backfill may dispatch to. Injectable so tests can assert
 * the routing without driving Playwright or the network — in particular that a
 * listing provider never falls through to the generic RSS backfill, which would
 * hand its HTML endpoint URL to the feed parser.
 */
export type { BackfillHandlers } from './providers/adapters/registry';
export async function backfillViaEndpoint(feed: QueueFeed, endpoint: RefreshEndpointCandidate | null,
  request: RssWorkerRequest, feedStartedAt: number, handlers?: BackfillHandlers): Promise<EndpointAttemptResult> {
  return executeSourceAdapter({ mode: 'backfill', feed, endpoint, allowCreate: false,
    history: { since: request.options?.since, maxPages: request.options?.maxPages ?? request.options?.maxPagesPerFeed,
      historyStepPages: request.yieldAfterFeeds ? 1 : undefined, historyCursor: request.continuation?.pendingHistory?.cursor }, startedAt: feedStartedAt,
    shouldStop: () => isCancelled(request.requestId) }, handlers);
}

async function backfillOneFeed(feed: QueueFeed, request: RssWorkerRequest): Promise<EndpointFeedExecutionResult> {
  const pending = request.continuation?.pendingHistory;
  const startedAt = pending?.startedAt ?? Date.now();
  const endpoints = pending ? [pending.endpoint] : listRefreshEndpointsForFeed(feed.id);
  const attempts: EndpointAttemptResult[] = [];

  if (endpoints.length === 0) {
    return {
      id: feed.id,
      url: feed.url,
      endpointId: null,
      ok: false,
      resolvedFeedId: feed.id,
      error: 'SOURCE_ENDPOINTS_COOLDOWN',
      newEntries: 0,
      attempts,
    };
  }

  const selectedEndpoints = pickBackfillEndpoints(endpoints);
  for (const endpoint of selectedEndpoints) {
    const attempt = await backfillViaEndpoint(feed, endpoint, request, startedAt);
    attempts.push(attempt);
    if (attempt.ok || !affectsEndpointHealth(attempt.errorKind) || isCancelled(request.requestId)) {
      break;
    }
  }

  const finalAttempt = attempts[attempts.length - 1];
  return {
    id: finalAttempt?.resolvedFeedId ?? feed.id,
    url: feed.url,
    endpointId: finalAttempt?.endpointId ?? null,
    ok: Boolean(finalAttempt?.ok),
    resolvedFeedId: finalAttempt?.resolvedFeedId ?? feed.id,
    error: finalAttempt?.error,
    errorKind: finalAttempt?.errorKind,
    cancelled: finalAttempt?.cancelled,
    pages: finalAttempt?.pages ?? pending?.cursor.pages,
    historyEnd: finalAttempt?.historyEnd,
    scannedItems: finalAttempt?.scannedItems ?? pending?.cursor.scannedItems,
    reachedBoundary: finalAttempt?.reachedBoundary,
    historyCapable: finalAttempt?.historyCapable,
    newEntries: (finalAttempt?.newEntries ?? 0) + (pending?.newEntries ?? 0),
    pendingHistory: finalAttempt?.historyContinuation ? { feedId: feed.id, startedAt,
      endpoint: selectedEndpoints.find((endpoint) => endpoint.endpointId === finalAttempt.endpointId)!,
      cursor: finalAttempt.historyContinuation, newEntries: (pending?.newEntries ?? 0) + (finalAttempt.newEntries ?? 0) } : undefined,
    attempts,
  };
}

function resolveRunType(kind: RssJobKind) {
  return kind.startsWith('backfill') ? 'backfill' : 'refresh';
}

async function executeBatchRequest(request: RssWorkerRequest): Promise<RssWorkerResult | RssWorkerCheckpoint> {
  if (!request.continuation) await initializeReaderData();
  const refreshTarget = request.kind === 'refresh_url' ? createVirtualFeedFromRefreshInput(request) : null;
  const feeds = request.continuation
    ? request.continuation.remainingFeeds.map((feed) => ({ ...feed, hostKey: getHostKey(feed.url) }))
    : refreshTarget
    ? [refreshTarget]
    : request.kind.endsWith('_feed')
      ? pickFeedsForRequest({
          ...request,
          options: {
            ...request.options,
            feedIds: request.feedId ? [request.feedId] : request.options?.feedIds ?? [],
          },
        })
      : pickFeedsForRequest(request);
  const runId = request.continuation?.progress.runId ?? createPipelineRun({
    runType: resolveRunType(request.kind),
    trigger: request.trigger,
    totalFeeds: feeds.length,
    metadata: {
      ...(request.metadata ?? {}),
      kind: request.kind,
      feedIds: feeds.map((feed) => feed.id),
    },
  });
  const progress = request.continuation?.progress ?? createProgressBase(request, runId, feeds.length);
  const results: FeedJobResult[] = request.continuation?.results ?? [];
  const followUpBackfillFeedIds: string[] = request.continuation?.followUpBackfillFeedIds ?? [];
  activeProgress = progress;
  activeResults = results;
  const stepFeeds = feeds.slice(0, request.yieldAfterFeeds ?? feeds.length);
  let pendingHistory: PendingRssHistory | undefined;

  postMessage({ type: 'progress', payload: progress });

  const runFeed = async (feed: QueueFeed) => {
    const feedStartedAt = request.continuation?.pendingHistory?.startedAt ?? Date.now();
    const result = request.kind.startsWith('backfill')
      ? await backfillOneFeed(feed, request)
      : await refreshOneFeed(feed, request);
    if (result.pendingHistory && !isCancelled(request.requestId)) { pendingHistory = result.pendingHistory; return; }
    if (result.pendingHistory) Object.assign(result, { ok: false, cancelled: true, error: 'CANCELLED', errorKind: 'cancelled' });
    delete result.pendingHistory;
    results.push(result);
    progress.feedsCompleted += 1;
    if (result.ok) {
      progress.feedsSucceeded += 1;
    } else {
      progress.feedsFailed += 1;
    }
    progress.newEntries += result.newEntries ?? 0;
    progress.currentFeedId = feed.id;
    progress.currentFeedUrl = feed.url;
    updatePipelineRun(runId, {
      feedsCompleted: progress.feedsCompleted,
      feedsSucceeded: progress.feedsSucceeded,
      feedsFailed: progress.feedsFailed,
      newEntries: progress.newEntries,
    });
    const feedFinishedAt = Date.now();
    if (isEndpointFeedExecutionResult(result)) {
      const runType = request.kind.startsWith('backfill') ? 'backfill' : 'refresh';
      if (result.attempts.length === 0) {
        // No endpoint ran at all (every one of them is cooling down). Record the
        // run for diagnostics, but keep it out of endpoint health: attributing it
        // to the primary endpoint used to inflate its failure counter and
        // overwrite the real error that put it into cooldown.
        createFeedRunResult({
          pipelineRunId: runId,
          feedId: result.resolvedFeedId ?? feed.id,
          endpointId: result.endpointId ?? null,
          runType,
          trigger: request.trigger,
          startedAt: feedStartedAt,
          finishedAt: feedFinishedAt,
          status: 'failed',
          error: result.error ?? null,
          newEntries: 0,
          affectsEndpointHealth: false,
        });
      } else {
        for (const [attemptIndex, attempt] of result.attempts.entries()) {
          const isFinalAttempt = attemptIndex === result.attempts.length - 1;
          createFeedRunResult({
            pipelineRunId: runId,
            feedId: attempt.resolvedFeedId ?? feed.id,
            endpointId: attempt.endpointId,
            runType,
            trigger: request.trigger,
            startedAt: feedStartedAt,
            finishedAt: feedFinishedAt,
            status: result.cancelled || attempt.cancelled ? 'cancelled' : attempt.ok ? (attempt.notModified ? 'not_modified' : 'success') : 'failed',
            error: attempt.error ?? null,
            notModified: attempt.notModified,
            newEntries: isFinalAttempt ? (result.newEntries ?? 0) : 0,
            affectsEndpointHealth: !result.cancelled && affectsEndpointHealth(attempt.errorKind),
          });
        }
      }
    }
    if (
      AUTO_ONE_TIME_HISTORY_BACKFILL &&
      result.ok &&
      request.kind !== 'refresh_url' &&
      request.kind.startsWith('refresh') &&
      feed.historySyncedAt === null
    ) {
      followUpBackfillFeedIds.push(feed.id);
    }
    postMessage({ type: 'progress', payload: { ...progress } });
  };

  const concurrency = request.kind.startsWith('backfill')
    ? DEFAULT_BACKFILL_CONCURRENCY
    : Math.max(1, Math.min(12, Math.floor(request.options?.refreshConcurrency ?? DEFAULT_REFRESH_CONCURRENCY)));
  const perHostConcurrency = Math.max(
    1,
    Math.min(2, Math.floor(request.options?.perHostConcurrency ?? DEFAULT_PER_HOST_CONCURRENCY)),
  );

  let errorMessage: string | undefined;
  try {
    await runFeedBatch(
      stepFeeds,
      concurrency,
      perHostConcurrency,
      (feed, shouldStop) => withRequestBudget({ shouldStop, perHostConcurrency }, () => runFeed(feed)),
      () => isCancelled(request.requestId),
    );
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const cancelled = isCancelled(request.requestId);
  if (!cancelled && !errorMessage && (pendingHistory || stepFeeds.length < feeds.length)) {
    return { progress, results, followUpBackfillFeedIds, pendingHistory,
      remainingFeeds: pendingHistory ? feeds : feeds.slice(stepFeeds.length) };
  }
  const hasFailure = Boolean(errorMessage) || results.some((item) => !item.ok);
  updatePipelineRun(runId, {
    status: cancelled ? 'cancelled' : hasFailure ? 'failed' : 'completed',
    finishedAt: Date.now(),
    feedsCompleted: progress.feedsCompleted,
    feedsSucceeded: progress.feedsSucceeded,
    feedsFailed: progress.feedsFailed,
    newEntries: progress.newEntries,
    error: errorMessage ?? null,
  });

  return {
    requestId: request.requestId,
    runId,
    kind: request.kind,
    trigger: request.trigger,
    totalFeeds: progress.totalFeeds,
    feedsCompleted: progress.feedsCompleted,
    feedsSucceeded: progress.feedsSucceeded,
    feedsFailed: progress.feedsFailed,
    newEntries: progress.newEntries,
    results,
    // A cancelled or fatally failed batch must not queue more work behind itself.
    followUpBackfillFeedIds: cancelled || errorMessage ? [] : followUpBackfillFeedIds,
    cancelled,
    error: errorMessage,
  };
}

let activeRequestId: string | null = null;

process.on('message', async (message: RssWorkerInboundMessage | undefined) => {
  if (!message || (message as { type?: string }).type?.match(/^(browser|network):/)) return;

  if (isCancelMessage(message)) {
    cancelledRequestIds.add(message.requestId);
    return;
  }

  if (activeRequestId !== null) {
    postMessage({ type: 'result', payload: { requestId: message.requestId, runId: '', kind: message.kind,
      trigger: message.trigger, totalFeeds: 0, feedsCompleted: 0, feedsSucceeded: 0, feedsFailed: 0,
      newEntries: 0, results: [], followUpBackfillFeedIds: [], error: 'WORKER_BUSY' } });
    return;
  }
  activeRequestId = message.requestId;

  try {
    const result = await withRequestBudget({ shouldStop: () => isCancelled(message.requestId), priority: message.priority }, () => executeBatchRequest(message));
    if ('remainingFeeds' in result) postMessage({ type: 'yielded', payload: result });
    else postMessage({ type: 'result', payload: result });
  } catch (error) {
    const progress = activeProgress ?? createProgressBase(message, '', 0);
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (progress.runId) {
      try { updatePipelineRun(progress.runId, { status: 'failed', finishedAt: Date.now(), error: errorMessage }); }
      catch (persistenceError) { console.error('[rss] unable to persist failed task', persistenceError); }
    }
    postMessage({
      type: 'result',
      payload: {
        ...progress,
        results: activeResults,
        followUpBackfillFeedIds: [],
        error: errorMessage,
      },
    });
  } finally {
    cancelledRequestIds.delete(message.requestId);
    activeRequestId = null;
    activeProgress = null;
    activeResults = [];
  }
});

postMessage({ type: 'ready' });

// A worker is owned by its parent; never keep an orphan writing to the database.
process.once('disconnect', () => process.exit(0));
