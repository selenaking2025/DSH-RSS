import { acceptPerformanceMetric, recordMetric } from './diagnostics/performance';
import { handleNetworkMessage, releaseNetworkOwner } from './network/request-broker';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import {
  CATPAW_SQLITE_BUSY_TIMEOUT_ENV_KEY,
  CATPAW_USER_DATA_ENV_KEY,
} from './app-identity';
import {
  BACKGROUND_JOB_PRIORITY_WEIGHT,
  createBackgroundJobQueueStats,
  type BackgroundJobFailure,
  type BackgroundJobPriority,
} from './contracts/background-jobs';
import { resolveUserDataDir } from './runtime';

const isTsRuntime = __filename.endsWith('.ts');
const WORKER_READY_TIMEOUT_MS = 10_000;
const LEGACY_SNOWPAW_USER_DATA_ENV_KEY = 'SNOWPAW_USER_DATA_DIR';
const LEGACY_SNOWPAW_SQLITE_BUSY_TIMEOUT_ENV_KEY = 'SNOWPAW_SQLITE_BUSY_TIMEOUT_MS';

type WorkerReadyMessage = {
  type: 'ready';
};

type WorkerLogMessage = {
  type: 'log';
  payload: {
    level: 'info' | 'warn' | 'error';
    message: string;
  };
};

type WorkerControlMessage = WorkerReadyMessage | WorkerLogMessage;

export type WorkerQueueJob<Request extends { requestId: string }, Result> = {
  priority: BackgroundJobPriority;
  sequence: number;
  enqueuedAt: number;
  queuedSince?: number;
  request: Request;
  resolve: (result: Result) => void;
  reject: (error: Error) => void;
};

export abstract class ChildWorkerManager<
  Request extends { requestId: string },
  Result,
  Job extends WorkerQueueJob<Request, Result>,
  Message extends { type: string },
  CurrentState = null,
> {
  protected worker: ChildProcess | null = null;
  protected queue: Job[] = [];
  protected current: Job | null = null;
  protected currentState: CurrentState | null = null;
  protected lastFailure: BackgroundJobFailure | null = null;
  private workerReady = false;
  private starting: Promise<ChildProcess> | null = null;
  private stopStarting: ((error: Error) => void) | null = null;
  private phase: 'idle' | 'starting' | 'running' | 'stopping' = 'idle';
  private stopping: Promise<void> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private pauses = 0;
  private readonly closedWorkers = new WeakSet<ChildProcess>();
  private readonly listeners = new Set<() => void>();
  private readonly dataListeners = new Set<() => void>();

  subscribeDataChanges(listener: () => void) {
    this.dataListeners.add(listener);
    return () => { this.dataListeners.delete(listener); };
  }

  protected dataChanged() {
    for (const listener of this.dataListeners) listener();
  }
  protected publishesDataChange(_job: Job) { return true; }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  protected changed() {
    for (const listener of this.listeners) listener();
  }

  protected getJobTimeoutMs(_job: Job) { return 3 * 60_000; }
  protected getReadyTimeoutMs() { return WORKER_READY_TIMEOUT_MS; }
  protected getStopTimeoutMs() { return 1_000; }

  pause() {
    this.pauses++;
    let resumed = false;
    const drained = new Promise<void>((resolve) => {
      const check = () => {
        if (this.current || this.stopping) return;
        this.listeners.delete(check); resolve();
      };
      this.listeners.add(check); check();
    });
    return { drained, resume: () => {
      if (resumed) return;
      resumed = true; this.pauses--; void this.pumpQueue();
    } };
  }

  protected enqueueJob(job: Job) {
    if (this.closed || this.queue.length >= 500) {
      job.reject(new Error(this.closed ? 'WORKER_SHUTDOWN' : 'WORKER_QUEUE_FULL'));
      return;
    }
    job.queuedSince = Date.now();
    this.queue.push(job);
    this.queue.sort((a, b) => BACKGROUND_JOB_PRIORITY_WEIGHT[b.priority]
      - BACKGROUND_JOB_PRIORITY_WEIGHT[a.priority] || a.sequence - b.sequence);
    this.changed();
    void this.pumpQueue();
  }

  protected cancelBeforeDispatch(result: Result) {
    if (!this.current || this.phase !== 'starting') return false;
    this.resolveCurrent(result);
    return true;
  }

  shutdown() {
    this.closed = true;
    for (const job of this.queue.splice(0)) {
      const error = new Error('WORKER_SHUTDOWN');
      try { this.onQueuedJobDropped(job, error); }
      catch (persistenceError) { console.error(`[${this.getWorkerLogPrefix()}] failed to record queued shutdown`, persistenceError); job.reject(error); }
    }
    this.changed();
    return this.failWorker(new Error('WORKER_SHUTDOWN'));
  }

  protected onQueuedJobDropped(job: Job, error: Error) { job.reject(error); }

  /** Called only after the worker has settled every active branch in this step. */
  protected requeueCurrent() {
    const job = this.current;
    if (!job) return;
    this.current = null;
    this.currentState = null;
    this.clearDeadline();
    this.phase = 'idle';
    job.queuedSince = Date.now();
    this.queue.push(job);
    this.queue.sort((a, b) => BACKGROUND_JOB_PRIORITY_WEIGHT[b.priority]
      - BACKGROUND_JOB_PRIORITY_WEIGHT[a.priority] || a.sequence - b.sequence);
    this.changed();
    this.dataChanged();
    void this.pumpQueue();
  }

  protected abstract getWorkerBaseName(): string;
  protected abstract handleWorkerPayload(message: Exclude<Message, WorkerControlMessage>): void;

  protected startJob(_job: Job): CurrentState | null {
    return null;
  }

  protected onWorkerExit(error: Error, current: Job | null, _currentState: CurrentState | null) {
    if (current) {
      current.reject(error);
    }
  }

  protected getCurrentRequestId() {
    return this.current?.request.requestId ?? null;
  }

  protected getQueueTelemetry() {
    const queuedByPriority = createBackgroundJobQueueStats();
    for (const job of this.queue) {
      queuedByPriority[job.priority] += 1;
    }
    return {
      queueDepth: this.queue.length + (this.current ? 1 : 0),
      queuedByPriority,
      lastFailure: this.lastFailure,
    };
  }

  protected getWorkerEnv() {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      CATPAW_WORKER_LIFETIME_FD: '4',
      CATPAW_REQUEST_BROKER: '1',
    };
    delete env[LEGACY_SNOWPAW_USER_DATA_ENV_KEY];
    delete env[LEGACY_SNOWPAW_SQLITE_BUSY_TIMEOUT_ENV_KEY];
    env[CATPAW_USER_DATA_ENV_KEY] = resolveUserDataDir();
    env[CATPAW_SQLITE_BUSY_TIMEOUT_ENV_KEY] = process.env[CATPAW_SQLITE_BUSY_TIMEOUT_ENV_KEY] ?? '5000';
    return env;
  }

  protected getWorkerLogPrefix() {
    return this.getWorkerBaseName();
  }

  protected takeNextJob() {
    return this.queue.shift();
  }

  protected createWorkerProcess() {
    return fork(this.resolveWorkerPath(), [], {
      env: this.getWorkerEnv(),
      execArgv: isTsRuntime ? ['-r', 'tsx/cjs'] : [],
      // Commands inherit fd 4 into their supervisors; EOF is the cleanup barrier.
      stdio: ['inherit', 'inherit', 'inherit', 'ipc', 'pipe'],
    });
  }

  protected resolveCurrent(result: Result) {
    if (!this.current) return;
    const doneJob = this.current;
    this.current = null;
    this.currentState = null;
    this.clearDeadline();
    this.phase = 'idle';
    this.changed();
    if (this.publishesDataChange(doneJob)) this.dataChanged();
    doneJob.resolve(result);
    void this.pumpQueue();
  }

  protected rejectCurrent(error: Error) {
    if (!this.current) return;
    const doneJob = this.current;
    this.recordFailure(doneJob, error);
    this.current = null;
    this.currentState = null;
    this.clearDeadline();
    this.phase = 'idle';
    this.changed();
    if (this.publishesDataChange(doneJob)) this.dataChanged();
    doneJob.reject(error);
    void this.pumpQueue();
  }

  protected recordFailure(job: Job, error: Error) {
    this.lastFailure = {
      requestId: job.request.requestId,
      priority: job.priority,
      message: error.message,
      failedAt: Date.now(),
    };
  }

  protected async pumpQueue() {
    if (this.closed || this.pauses || this.stopping || this.current || this.queue.length === 0) return;
    const next = this.takeNextJob();
    if (!next) return;

    recordMetric('queue.wait', Date.now() - (next.queuedSince ?? next.enqueuedAt));
    // Reserve ownership synchronously, before even an already-resolved await.
    this.current = next;
    this.phase = 'starting';
    try {
      this.currentState = this.startJob(next);
      this.changed();
      const worker = await this.ensureWorker();
      if (this.current !== next || this.closed) return;
      this.phase = 'running';
      this.deadline = setTimeout(() => {
        if (this.current === next) this.failWorker(new Error('WORKER_JOB_TIMEOUT'));
      }, this.getJobTimeoutMs(next));
      this.deadline.unref?.();
      await this.sendToWorker(worker, next.request);
    } catch (error) {
      // A cancelled job or an old worker must never settle its successor.
      if (this.current !== next) return;
      this.failWorker(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private clearDeadline() {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
  }

  protected failWorker(error: Error, alreadyExited = false): Promise<void> {
    if (this.stopping) return this.stopping;
    const worker = this.worker;
    const current = this.current;
    const state = this.currentState;
    if (worker) require('./browser/host').cancelBrowserOwner(worker.pid);
    this.worker = null;
    this.workerReady = false;
    this.phase = 'stopping';
    this.clearDeadline();
    this.stopStarting?.(error);
    this.stopStarting = null;
    this.starting = null;
    this.stopping = Promise.resolve().then(async () => {
      if (worker) { await this.stopWorker(worker, alreadyExited); releaseNetworkOwner(worker.pid); }
      if (current) this.recordFailure(current, error);
      try {
        this.onWorkerExit(error, current, state);
      } catch (persistenceError) {
        console.error(`[${this.getWorkerLogPrefix()}] failed to record worker exit`, persistenceError);
      } finally {
        current?.reject(error);
        this.current = null;
        this.currentState = null;
        this.phase = 'idle';
        this.stopping = null;
        this.changed();
        if (current && this.publishesDataChange(current)) this.dataChanged();
        void this.pumpQueue();
      }
    });
    return this.stopping;
  }

  private stopWorker(worker: ChildProcess, alreadyExited: boolean) {
    const lifetime = worker.stdio?.[4] as (NodeJS.ReadableStream & { destroyed?: boolean }) | undefined;
    const exited = alreadyExited || worker.exitCode != null || worker.signalCode != null;
    if (this.closedWorkers.has(worker)) return Promise.resolve();
    // Electron may omit ChildProcess.close after an explicit IPC disconnect.
    // Await the process and lifetime pipe separately rather than that aggregate.
    const cleanup = !lifetime || lifetime.destroyed ? Promise.resolve() : new Promise<void>((resolve) => {
      lifetime.once('close', resolve);
      lifetime.resume();
    });
    const exit = exited ? Promise.resolve() : new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(escalation);
        worker.removeListener('exit', done);
        worker.removeListener('close', done);
        resolve();
      };
      const escalation = setTimeout(() => worker.kill('SIGKILL'), this.getStopTimeoutMs());
      worker.once('exit', done);
      worker.once('close', done);
      worker.kill('SIGTERM');
    });
    return Promise.all([exit, cleanup]).then(() => {});
  }

  private resolveWorkerPath() {
    const baseName = this.getWorkerBaseName();
    return path.join(__dirname, isTsRuntime ? `${baseName}.ts` : `${baseName}.js`);
  }

  private ensureWorker(): Promise<ChildProcess> {
    if (this.worker?.connected && this.workerReady) return Promise.resolve(this.worker);
    if (this.starting) return this.starting;
    // An unavailable worker must go through the same awaited retirement path.
    if (this.worker) throw new Error(`${this.getWorkerLogPrefix()} worker channel is not available`);
    const worker = this.createWorkerProcess();
    worker.once('close', () => { this.closedWorkers.add(worker); });
    this.worker = worker;
    this.workerReady = false;
    const ready = new Promise<ChildProcess>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${this.getWorkerLogPrefix()} worker did not become ready`));
      }, this.getReadyTimeoutMs());
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        worker.removeListener('message', onReady);
        if (error) reject(error);
        else resolve(worker);
      };
      const onReady = (message: Message) => {
        if (this.worker === worker && message?.type === 'ready') {
          this.workerReady = true;
          finish();
        }
      };
      this.stopStarting = finish;
      worker.on('message', onReady);
    });
    this.starting = ready;
    void ready.finally(() => {
      if (this.starting === ready) {
        this.starting = null;
        this.stopStarting = null;
      }
    }).catch(() => {});

    worker.on('message', (message: Message) => {
      if (this.worker !== worker) return;
      try {
        if (!message || typeof message !== 'object' || typeof message.type !== 'string') throw new Error('WORKER_INVALID_MESSAGE');
        if (acceptPerformanceMetric(message)) return;
        if (handleNetworkMessage(worker, message)) return;
        if (message.type.startsWith('browser:') && require('./browser/host').handleBrowserMessage(worker, message)) return;
        this.handleWorkerMessage(message);
      } catch (error) { void this.failWorker(error instanceof Error ? error : new Error(String(error))); }
    });
    worker.on('error', (error) => {
      if (this.worker === worker) this.failWorker(error);
    });
    worker.on('exit', (code, signal) => {
      if (this.worker !== worker) return;
      const reason = this.phase === 'starting' ? 'exited before it became ready' : 'exited unexpectedly';
      void this.failWorker(new Error(`${this.getWorkerLogPrefix()} ${reason} (${signal ?? code ?? 'unknown'})`), true);
    });
    return ready;
  }

  private async sendToWorker(worker: ChildProcess, request: Request) {
    if (this.worker !== worker || !worker.connected || worker.killed) {
      throw new Error(`${this.getWorkerLogPrefix()} worker channel is not available`);
    }

    await new Promise<void>((resolve, reject) => {
      try {
        worker.send(request, (error) => {
          if (error) {
            if (this.worker === worker && this.current?.request.requestId === request.requestId) this.failWorker(error);
            reject(error);
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleWorkerMessage(message: Message) {
    if (this.isWorkerReadyMessage(message)) {
      this.workerReady = true;
      return;
    }

    if (this.isWorkerLogMessage(message)) {
      if (!message.payload || !['info', 'warn', 'error'].includes(message.payload.level) || typeof message.payload.message !== 'string') {
        throw new Error('WORKER_INVALID_LOG');
      }
      const logger = message.payload.level === 'error'
        ? console.error
        : message.payload.level === 'warn'
          ? console.warn
          : console.info;
      logger(`[${this.getWorkerLogPrefix()}] ${message.payload.message}`);
      return;
    }

    this.handleWorkerPayload(message as Exclude<Message, WorkerControlMessage>);
  }

  private isWorkerReadyMessage(message: Message): message is Message & WorkerReadyMessage {
    return message.type === 'ready';
  }

  private isWorkerLogMessage(message: Message): message is Message & WorkerLogMessage {
    return message.type === 'log';
  }
}
