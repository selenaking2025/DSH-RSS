import type { RssHistoryCursor } from './rss-history';
import type { RefreshEndpointCandidate } from './reader';
import type { BackgroundJobFailure, BackgroundJobPriority, BackgroundJobQueueStats } from './background-jobs';
import type { FeedFailureSummary, SourceEndpointHealthSummary } from './reader';
import type { BatchFeedRunResult } from './feed-run';
import type { Feed } from './reader';

export type RssJobKind = 'refresh_all' | 'refresh_feed' | 'refresh_url' | 'backfill_all' | 'backfill_feed';
export type RssJobTrigger = 'manual' | 'startup' | 'interval' | 'resume' | 'scheduled' | 'add_feed';

export type FeedJobResult = BatchFeedRunResult & {
  endpointId?: string | null;
  resolvedFeedId?: string;
};

export type RssBatchJobOptions = {
  feedIds?: string[];
  since?: number | null;
  maxPages?: number | null;
  maxPagesPerFeed?: number | null;
  refreshConcurrency?: number | null;
  perHostConcurrency?: number | null;
};

export type RssWorkerRequest = {
  requestId: string;
  kind: RssJobKind;
  trigger: RssJobTrigger;
  priority?: BackgroundJobPriority;
  options?: RssBatchJobOptions;
  feedId?: string;
  metadata?: Record<string, unknown>;
  refreshInput?: {
    url: string;
    title?: string | null;
    groupId?: string | null;
    siteUrl?: string | null;
  };
  /** Internal scheduling boundary; never accepted from a renderer. */
  yieldAfterFeeds?: number;
  continuation?: RssWorkerCheckpoint;
};

// Sent from the main process to ask an in-flight batch to stop. Cancellation is
// cooperative: the worker finishes the page/feed it is on, then unwinds.
export type RssWorkerCancelMessage = {
  type: 'cancel';
  requestId: string;
};

export type RssWorkerInboundMessage = RssWorkerRequest | RssWorkerCancelMessage;

export type RssWorkerProgress = {
  requestId: string;
  runId: string;
  kind: RssJobKind;
  trigger: RssJobTrigger;
  totalFeeds: number;
  feedsCompleted: number;
  feedsSucceeded: number;
  feedsFailed: number;
  newEntries: number;
  currentFeedId?: string;
  currentFeedUrl?: string;
};

export type RssWorkerResult = {
  requestId: string;
  runId: string;
  kind: RssJobKind;
  trigger: RssJobTrigger;
  totalFeeds: number;
  feedsCompleted: number;
  feedsSucceeded: number;
  feedsFailed: number;
  newEntries: number;
  results: FeedJobResult[];
  followUpBackfillFeedIds?: string[];
  cancelled?: boolean;
  error?: string;
};

export type PendingRssHistory = {
  feedId: string;
  cursor: RssHistoryCursor;
  endpoint: RefreshEndpointCandidate;
  startedAt: number;
  newEntries: number;
};

export type RssWorkerCheckpoint = {
  pendingHistory?: PendingRssHistory;
  progress: RssWorkerProgress;
  results: FeedJobResult[];
  followUpBackfillFeedIds: string[];
  remainingFeeds: Feed[];
};

export type RssWorkerReadyMessage = {
  type: 'ready';
};

export type RssWorkerProgressMessage = {
  type: 'progress';
  payload: RssWorkerProgress;
};

export type RssWorkerResultMessage = {
  type: 'result';
  payload: RssWorkerResult;
};

export type RssWorkerLogMessage = {
  type: 'log';
  payload: {
    level: 'info' | 'warn' | 'error';
    message: string;
  };
};

export type RssWorkerMessage =
  | RssWorkerReadyMessage
  | RssWorkerProgressMessage
  | RssWorkerResultMessage
  | RssWorkerLogMessage
  | { type: 'yielded'; payload: RssWorkerCheckpoint };

export type SchedulerStatus = {
  nextRefreshAt: number | null;
  currentJob: (RssWorkerProgress & { priority: BackgroundJobPriority; enqueuedAt: number; startedAt: number }) | null;
  queueDepth: number;
  queuedByPriority: BackgroundJobQueueStats;
  lastFailure: BackgroundJobFailure | null;
  providerHealth: SourceEndpointHealthSummary;
  recentFailures: FeedFailureSummary;
  lastRun: {
    id: string;
    status: string;
    startedAt: number;
    finishedAt: number | null;
    totalFeeds: number;
    feedsCompleted: number;
    feedsSucceeded: number;
    feedsFailed: number;
    newEntries: number;
    trigger: string;
  } | null;
};
