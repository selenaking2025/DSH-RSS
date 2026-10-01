import { rssJobManager } from '../rss-job-manager';
import type {
  RssBatchJobOptions,
  RssJobTrigger,
  RssWorkerResult,
} from '../contracts/rss-jobs';
import type { RssRunOutcome } from '../contracts/feed-run';
import { feedFailure } from '../feed-errors';

/** Task state and source results are separate at every UI/CLI boundary. */
export function failedRun(error: unknown): RssRunOutcome {
  const { error: message, errorKind, cancelled } = feedFailure(error);
  return { runId: null, status: cancelled ? 'cancelled' : 'failed', failure: { error: message, errorKind },
    progress: { total: 0, done: 0, succeeded: 0, failed: 0, newEntries: 0 }, feeds: [] };
}

export function toRunOutcome(result: RssWorkerResult): RssRunOutcome {
  const cancelled = Boolean(result.cancelled || result.results.some((feed) => feed.cancelled || feed.errorKind === 'cancelled'));
  const firstFailure = result.results.find((feed) => !feed.ok && feed.errorKind !== 'cancelled' && !feed.cancelled);
  const error = result.error || (cancelled ? 'CANCELLED' :
    result.feedsCompleted < result.totalFeeds ? 'RUN_INCOMPLETE' :
    result.kind.endsWith('_feed') && result.totalFeeds === 0 ? 'FEED_NOT_FOUND' : firstFailure?.error);
  const failed = Boolean(error || firstFailure);
  const status = result.error ? 'failed' : cancelled ? 'cancelled' : failed ? 'failed' : 'completed';
  const base = { runId: result.runId || null, feeds: result.results,
    progress: { total: result.totalFeeds,
      done: Math.max(0, result.feedsCompleted - result.results.filter((feed) => feed.cancelled || feed.errorKind === 'cancelled').length),
      succeeded: result.feedsSucceeded, failed: result.feedsFailed, newEntries: result.newEntries } };
  if (status === 'completed') return { ...base, status };
  const failure = feedFailure(error ?? 'SOURCE_FAILED',
    !result.error && !cancelled && firstFailure ? firstFailure.errorKind : undefined);
  return { ...base, status, failure: { error: failure.error, errorKind: failure.errorKind } };
}

export async function enqueueRefreshAll(input?: {
  trigger?: RssJobTrigger;
  options?: RssBatchJobOptions;
  metadata?: Record<string, unknown>;
}) {
  return await rssJobManager.enqueue({
    kind: 'refresh_all',
    trigger: input?.trigger ?? 'manual',
    options: input?.options,
    metadata: input?.metadata,
  });
}

export async function enqueueRefreshFeed(input: {
  feedId: string;
  trigger?: RssJobTrigger;
  metadata?: Record<string, unknown>;
}) {
  return await rssJobManager.enqueue({
    kind: 'refresh_feed',
    trigger: input.trigger ?? 'manual',
    feedId: input.feedId,
    metadata: input.metadata,
  });
}

export async function enqueueBackfillFeed(input: {
  feedId: string;
  trigger?: RssJobTrigger;
  options?: { since?: number | null; maxPages?: number | null };
  metadata?: Record<string, unknown>;
}) {
  return await rssJobManager.enqueue({
    kind: 'backfill_feed',
    trigger: input.trigger ?? 'manual',
    feedId: input.feedId,
    options: input.options,
    metadata: input.metadata,
  });
}

export async function enqueueBackfillAll(input?: {
  trigger?: RssJobTrigger;
  options?: RssBatchJobOptions;
  metadata?: Record<string, unknown>;
}) {
  return await rssJobManager.enqueue({
    kind: 'backfill_all',
    trigger: input?.trigger ?? 'manual',
    options: input?.options,
    metadata: input?.metadata,
  });
}
