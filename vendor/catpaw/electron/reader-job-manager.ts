import { markEntryContentFetchResult } from './data/entry-repo';
import {
  BACKGROUND_JOB_PRIORITY_WEIGHT,
  type BackgroundJobPriority,
} from './contracts/background-jobs';
import { ChildWorkerManager, type WorkerQueueJob } from './child-worker-manager';
import type { ReaderJobKind, ReaderJobStatus, ReaderWorkerMessage, ReaderWorkerRequest } from './contracts/reader-worker';
import { parseReaderJobResult, type ReaderJobResults } from './contracts/reader-jobs';

type PendingJob = WorkerQueueJob<ReaderWorkerRequest, unknown> & {
  key: string;
};

type CurrentReaderJobState = {
  requestId: string;
  kind: ReaderJobKind;
  entryId: string;
  enqueuedAt: number;
  startedAt: number;
};

export class ReaderJobManager extends ChildWorkerManager<
  ReaderWorkerRequest,
  unknown,
  PendingJob,
  ReaderWorkerMessage,
  CurrentReaderJobState
> {
  private requestCounter = 0;
  private queueSequence = 0;
  private inflight = new Map<string, Promise<unknown>>();

  async enqueue<K extends ReaderJobKind>(input: {
    kind: K;
    entryId: string;
    userDataDir?: string | null;
    priority?: BackgroundJobPriority;
  }): Promise<ReaderJobResults[K]> {
    const key = `${input.kind}:${input.entryId}`;
    const existing = this.inflight.get(key);
    if (existing) {
      const queued = this.queue.find((job) => job.key === key);
      const priority = input.priority ?? this.getPriority(input.kind);
      if (queued && BACKGROUND_JOB_PRIORITY_WEIGHT[priority] > BACKGROUND_JOB_PRIORITY_WEIGHT[queued.priority]) {
        queued.priority = priority; queued.request.priority = priority;
        this.queue.sort((a, b) => BACKGROUND_JOB_PRIORITY_WEIGHT[b.priority] - BACKGROUND_JOB_PRIORITY_WEIGHT[a.priority] || a.sequence - b.sequence);
      }
      return parseReaderJobResult(input.kind, await existing);
    }

    const request: ReaderWorkerRequest = {
      requestId: `${Date.now()}-${this.requestCounter += 1}`,
      kind: input.kind,
      entryId: input.entryId,
      userDataDir: input.userDataDir ?? null,
      priority: input.priority ?? this.getPriority(input.kind),
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.enqueueJob({
        key,
        priority: input.priority ?? this.getPriority(input.kind),
        sequence: this.queueSequence += 1,
        enqueuedAt: Date.now(),
        request,
        resolve,
        reject,
      });

    }).finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return parseReaderJobResult(input.kind, await promise);
  }

  getStatus(): ReaderJobStatus {
    const queuedByKind: ReaderJobStatus['queuedByKind'] = {
      fetch_entry_content: 0,
      resolve_xiaoyuzhou_audio: 0,
      get_social_thread: 0,
      prepare_article_summary: 0,
    };

    for (const job of this.queue) {
      queuedByKind[job.request.kind] += 1;
    }

    return {
      currentJob: this.currentState
        ? {
            requestId: this.currentState.requestId,
            kind: this.currentState.kind,
            entryId: this.currentState.entryId,
            enqueuedAt: this.currentState.enqueuedAt,
            startedAt: this.currentState.startedAt,
          }
        : null,
      queueDepth: this.queue.length + (this.current ? 1 : 0),
      inflightCount: this.inflight.size,
      queuedByKind,
      lastFailure: this.lastFailure,
    };
  }

  protected onWorkerExit(error: Error, job: PendingJob | null, state: CurrentReaderJobState | null) {
    try {
      if (job?.request.kind === 'fetch_entry_content') markEntryContentFetchResult(job.request.entryId, { status: 'failed', error: error.message });
    } finally { super.onWorkerExit(error, job, state); }
  }

  protected getWorkerBaseName() {
    return 'reader-worker';
  }

  protected getPriority(kind: ReaderJobKind): BackgroundJobPriority {
    if (kind === 'fetch_entry_content') return 'critical';
    if (kind === 'prepare_article_summary') return 'background';
    return 'interactive';
  }
  protected publishesDataChange(job: PendingJob) { return job.request.kind !== 'prepare_article_summary'; }

  protected startJob(job: PendingJob) {
    return {
      requestId: job.request.requestId,
      kind: job.request.kind,
      entryId: job.request.entryId,
      enqueuedAt: job.enqueuedAt,
      startedAt: Date.now(),
    };
  }

  protected handleWorkerPayload(message: Exclude<ReaderWorkerMessage, { type: 'ready' } | { type: 'log'; payload: { level: 'info' | 'warn' | 'error'; message: string } }>) {
    if (this.getCurrentRequestId() !== message.payload.requestId) {
      return;
    }

    if (message.payload.kind !== this.current?.request.kind) {
      this.rejectCurrent(new Error('READER_INVALID_RESULT'));
    } else if (message.payload.error) {
      this.rejectCurrent(new Error(message.payload.error));
    } else {
      try {
        this.resolveCurrent(parseReaderJobResult(message.payload.kind, message.payload.payload));
      } catch (error) {
        this.rejectCurrent(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}

export const readerJobManager = new ReaderJobManager();
