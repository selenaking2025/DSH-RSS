import {
  type BackgroundJobPriority,
} from './contracts/background-jobs';
import { ChildWorkerManager, type WorkerQueueJob } from './child-worker-manager';
import { parseRssWorkerPayload } from './contracts/rss-job-validation';
import { listPipelineRuns, updatePipelineRun } from './data/pipeline-run-repo';
import { createFeedRunResult, summarizeFeedFailures, summarizeSourceEndpointHealth } from './data/source-endpoint-repo';
import type {
  RssJobKind,
  RssJobTrigger,
  RssWorkerMessage,
  RssWorkerProgress,
  RssWorkerRequest,
  RssWorkerResult,
  SchedulerStatus,
} from './contracts/rss-jobs';

type PendingJob = WorkerQueueJob<RssWorkerRequest, RssWorkerResult> & { startedAt?: number };

type CurrentJobState = {
  requestId: string;
  priority: BackgroundJobPriority;
  enqueuedAt: number;
  startedAt: number;
  progress: RssWorkerProgress | null;
};

export class RssJobManager extends ChildWorkerManager<
  RssWorkerRequest,
  RssWorkerResult,
  PendingJob,
  RssWorkerMessage,
  CurrentJobState
> {
  private nextRefreshAt: number | null = null;
  private requestCounter = 0;
  private queueSequence = 0;
  private queuedAutoBackfillFeedIds = new Set<string>();
  private cancellationRequested = new Set<string>();

  setNextRefreshAt(timestamp: number | null) {
    this.nextRefreshAt = timestamp;
    this.changed();
  }

  isBusy() {
    return Boolean(this.current);
  }

  /**
   * Drops everything still queued and asks the worker to unwind the batch it is
   * running. Cancellation is cooperative, so the in-flight feed/page finishes and
   * whatever it committed is kept; callers awaiting a dropped job get a result
   * marked `cancelled` rather than a rejection.
   */
  cancelActiveJobs() {
    const queued = this.queue.splice(0, this.queue.length);
    for (const job of queued) {
      job.resolve(this.createCancelledResult(job.request));
    }
    this.queuedAutoBackfillFeedIds.clear();
    if (queued.length) this.changed();

    const current = this.current;
    if (current && this.cancelBeforeDispatch(this.createCancelledResult(current.request))) {
      return { ok: true, cancelledQueued: queued.length, cancellingCurrent: true };
    }
    const canReachWorker = Boolean(this.worker && this.worker.connected && !this.worker.killed);
    if (current && canReachWorker) {
      this.cancellationRequested.add(current.request.requestId);
      this.worker!.send({ type: 'cancel', requestId: current.request.requestId }, (error) => {
        if (error && this.current === current) this.failWorker(error);
      });
      return { ok: true, cancelledQueued: queued.length, cancellingCurrent: true };
    }

    return { ok: true, cancelledQueued: queued.length, cancellingCurrent: false };
  }

  private createCancelledResult(request: RssWorkerRequest): RssWorkerResult {
    const saved = request.continuation;
    if (saved) {
      const progress = { ...saved.progress };
      const results = [...saved.results];
      const pending = saved.pendingHistory;
      if (pending) {
        results.push({ id: pending.feedId, url: saved.remainingFeeds[0].url, ok: false, cancelled: true,
          error: 'CANCELLED', errorKind: 'cancelled', endpointId: pending.endpoint.endpointId,
          pages: pending.cursor.pages, scannedItems: pending.cursor.scannedItems, newEntries: pending.newEntries });
        progress.feedsCompleted += 1;
        progress.feedsFailed += 1;
        progress.newEntries += pending.newEntries;
      }
      let error: string | undefined;
      try {
        updatePipelineRun(progress.runId, { status: 'cancelled', finishedAt: Date.now(),
          feedsCompleted: progress.feedsCompleted, feedsFailed: progress.feedsFailed, newEntries: progress.newEntries });
        if (pending) createFeedRunResult({ pipelineRunId: progress.runId, feedId: pending.feedId,
          endpointId: pending.endpoint.endpointId, runType: 'backfill', trigger: request.trigger,
          startedAt: pending.startedAt, finishedAt: Date.now(), status: 'cancelled', error: 'CANCELLED',
          newEntries: pending.newEntries, affectsEndpointHealth: false });
      }
      catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
      return { ...progress, results, followUpBackfillFeedIds: [], cancelled: true, error };
    }
    return {
      requestId: request.requestId,
      runId: '',
      kind: request.kind,
      trigger: request.trigger,
      totalFeeds: 0,
      feedsCompleted: 0,
      feedsSucceeded: 0,
      feedsFailed: 0,
      newEntries: 0,
      results: [],
      followUpBackfillFeedIds: [],
      cancelled: true,
    };
  }

  getStatus(): SchedulerStatus {
    const lastRun = listPipelineRuns({ runType: 'refresh', limit: 1 })[0] ?? null;
    return {
      nextRefreshAt: this.nextRefreshAt,
      currentJob: this.currentState?.progress
        ? {
            ...this.currentState.progress,
            priority: this.currentState.priority,
            enqueuedAt: this.currentState.enqueuedAt,
            startedAt: this.currentState.startedAt,
          }
        : null,
      ...this.getQueueTelemetry(),
      providerHealth: summarizeSourceEndpointHealth(),
      recentFailures: summarizeFeedFailures(),
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            startedAt: lastRun.startedAt,
            finishedAt: lastRun.finishedAt,
            totalFeeds: lastRun.totalFeeds,
            feedsCompleted: lastRun.feedsCompleted,
            feedsSucceeded: lastRun.feedsSucceeded,
            feedsFailed: lastRun.feedsFailed,
            newEntries: lastRun.newEntries,
            trigger: lastRun.trigger,
          }
        : null,
    };
  }

  async enqueue(input: {
    kind: RssJobKind;
    trigger: RssJobTrigger;
    options?: RssWorkerRequest['options'];
    feedId?: string;
    metadata?: RssWorkerRequest['metadata'];
    refreshInput?: RssWorkerRequest['refreshInput'];
  }) {
    const request: RssWorkerRequest = {
      requestId: `${Date.now()}-${this.requestCounter += 1}`,
      kind: input.kind,
      trigger: input.trigger,
      options: input.options,
      feedId: input.feedId,
      metadata: input.metadata,
      refreshInput: input.refreshInput,
      yieldAfterFeeds: input.kind.startsWith('backfill') ? 1 : Math.max(1, Math.min(12, input.options?.refreshConcurrency ?? 6)),
    };
    request.priority = this.getPriority(request);

    return await new Promise<RssWorkerResult>((resolve, reject) => {
      this.enqueueJob({
        priority: this.getPriority(request),
        sequence: this.queueSequence += 1,
        enqueuedAt: Date.now(),
        request,
        resolve,
        reject,
      });

    });
  }

  private getPriority(request: RssWorkerRequest): BackgroundJobPriority {
    if (request.trigger === 'add_feed') return 'critical';
    if (request.kind.startsWith('refresh') && request.trigger === 'manual') return 'interactive';
    if (request.kind.startsWith('refresh') && request.trigger === 'scheduled') return 'scheduled';
    return 'background';
  }

  protected getJobTimeoutMs(job: PendingJob) {
    // A continuation keeps the original whole-run deadline. Yielding to another
    // job must not grant a fresh 30-minute budget for every remaining feed.
    return Math.max(1, 30 * 60_000 - (Date.now() - (job.startedAt ?? Date.now())));
  }

  protected getWorkerBaseName() {
    return 'rss-worker';
  }

  protected startJob(job: PendingJob) {
    job.startedAt ??= Date.now();
    return {
      requestId: job.request.requestId,
      priority: job.priority,
      enqueuedAt: job.enqueuedAt,
      startedAt: job.startedAt,
      progress: job.request.continuation?.progress ?? null,
    };
  }

  protected onQueuedJobDropped(job: PendingJob, error: Error) {
    const saved = job.request.continuation;
    try {
      if (saved) updatePipelineRun(saved.progress.runId, { status: 'failed', finishedAt: Date.now(), error: error.message });
    } finally { super.onQueuedJobDropped(job, error); }
  }

  protected onWorkerExit(error: Error, current: PendingJob | null, currentState: CurrentJobState | null) {
    if (current) this.cancellationRequested.delete(current.request.requestId);
    if (currentState?.progress?.runId) {
      updatePipelineRun(currentState.progress.runId, {
        status: 'failed',
        finishedAt: Date.now(),
        error: error.message,
      });
    }
    super.onWorkerExit(error, current, currentState);
  }

  protected handleWorkerPayload(input: unknown) {
    if (!this.current) return;
    let message;
    try { message = parseRssWorkerPayload(input, this.current.request, this.currentState?.progress ?? null); }
    catch (error) { void this.failWorker(error instanceof Error ? error : new Error(String(error))); return; }
    if (!message) return;
    if (message.type === 'yielded') {
      if (this.current?.request.requestId !== message.payload.progress.requestId) return;
      this.current.request.continuation = message.payload;
      if (this.cancellationRequested.delete(this.current.request.requestId)) {
        this.resolveCurrent(this.createCancelledResult(this.current.request));
        return;
      }
      this.requeueCurrent();
      return;
    }
    if (message.type === 'progress') {
      if (this.getCurrentRequestId() !== message.payload.requestId) {
        return;
      }
      if (message.payload.feedsCompleted > (this.currentState?.progress?.feedsCompleted ?? 0)) this.dataChanged();
      this.currentState = {
        requestId: message.payload.requestId,
        priority: this.currentState?.priority ?? this.current?.priority ?? 'background',
        enqueuedAt: this.currentState?.enqueuedAt ?? this.current?.enqueuedAt ?? Date.now(),
        startedAt: this.currentState?.startedAt ?? Date.now(),
        progress: message.payload,
      };
      this.changed();
      return;
    }

    if (this.getCurrentRequestId() !== message.payload.requestId) {
      return;
    }
    this.enqueueFollowUpBackfills(message.payload);
    this.cancellationRequested.delete(message.payload.requestId);
    this.resolveCurrent(message.payload);
  }

  private enqueueFollowUpBackfills(result: RssWorkerResult) {
    for (const feedId of result.followUpBackfillFeedIds ?? []) {
      if (!feedId || this.queuedAutoBackfillFeedIds.has(feedId)) {
        continue;
      }
      this.queuedAutoBackfillFeedIds.add(feedId);
      void this.enqueue({
        kind: 'backfill_feed',
        trigger: 'scheduled',
        feedId,
        metadata: {
          autoHistoryBackfill: true,
          sourceRunId: result.runId,
        },
      })
        .catch((error) => {
          console.warn(`[rss] auto history backfill enqueue failed for ${feedId}:`, error);
        })
        .finally(() => {
          this.queuedAutoBackfillFeedIds.delete(feedId);
        });
    }
  }
}

export const rssJobManager = new RssJobManager();
