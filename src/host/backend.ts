import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { errorMessage, isRecord, type BackendMessage } from '../shared/protocol.ts';
import { parseModelRequest, type ModelGenerator } from '../shared/model.ts';

type Pending = { resolve(value: unknown): void; reject(reason: Error): void; clean(): void };
export type BackendEvent = { sequence: number; owner?: string; channel: string; value: unknown };
export class CatpawBackend {
  private child?: ChildProcess;
  private pending = new Map<string, Pending>();
  private opening?: Promise<void>;
  private closing?: Promise<void>;
  private closed = false;
  private disposed = false;
  private restarting?: Promise<void>;
  private sequence = 0;
  private journal: BackendEvent[] = [];
  private listeners = new Set<() => void>();
  private logs = '';
  private modelRequests = new Map<string, AbortController>();
  public availableMethods: readonly string[] = [];
  constructor(readonly dataDir: string, private readonly options: { electronPath?: string; disableScheduler?: boolean;
    harnessModel?: { model: string; generate: ModelGenerator } } = {}) {}

  async start(): Promise<void> {
    if (this.closed) throw new Error('CATPAW_STOPPED');
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      const require = createRequire(import.meta.url);
      const executable = this.options.electronPath ?? require('electron') as string;
      const env: NodeJS.ProcessEnv = { ...process.env, CATPAW_USER_DATA_DIR: this.dataDir,
        ...(this.options.disableScheduler ? { CATPAW_DISABLE_SCHEDULER: '1' } : {}) };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.CATPAW_HARNESS_MODEL;
      delete env.JEV_API_KEY; delete env.TYPESAFE_API_KEY;
      if (this.options.harnessModel) env.CATPAW_HARNESS_MODEL = this.options.harnessModel.model;
      const child = spawn(executable, [fileURLToPath(new URL('./backend/index.js', import.meta.url))], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env,
      });
      this.child = child;
      const timer = setTimeout(() => { reject(new Error(`Catpaw startup timed out. ${this.logs}`)); void this.close(); }, 45_000);
      child.stdout?.on('data', data => this.appendLog(String(data)));
      child.stderr?.on('data', data => this.appendLog(String(data)));
      child.on('error', error => { clearTimeout(timer); reject(error); this.failPending(error); });
      child.on('exit', (code, signal) => {
        for (const controller of this.modelRequests.values()) controller.abort(); this.modelRequests.clear();
        clearTimeout(timer);
        const error = new Error(`Catpaw backend exited (${code ?? signal}). ${this.logs}`);
        reject(error); this.failPending(error); this.child = undefined;
        this.opening = undefined;
        this.publish({ channel: 'catpaw:status', value: { connected: false } });
      });
      child.on('message', (raw: unknown) => {
        if (!isRecord(raw) || typeof raw.kind !== 'string') return;
        if (raw.kind === 'model-request') { void this.generateModel(raw, child); return; }
        if (raw.kind === 'model-cancel' && typeof raw.id === 'string') { this.modelRequests.get(raw.id)?.abort(); return; }
        const message = raw as BackendMessage;
        if (message.kind === 'ready') { clearTimeout(timer); this.availableMethods = message.methods; resolve(); }
        else if (message.kind === 'fatal') { clearTimeout(timer); reject(new Error(message.error)); }
        else if (message.kind === 'event') this.publish(message);
        else if (message.kind === 'result') {
          const request = this.pending.get(message.id);
          if (!request) return;
          this.pending.delete(message.id); request.clean();
          if (message.ok) request.resolve(message.value); else request.reject(new Error(message.error));
        }
      });
    });
    return this.opening;
  }
  async call(method: string, args: unknown[] = [], owner = 'operator', signal?: AbortSignal): Promise<unknown> {
    if (this.restarting) await this.restarting;
    signal?.throwIfAborted(); await this.start(); signal?.throwIfAborted();
    if (!this.availableMethods.includes(method)) throw new Error(`UNKNOWN_CATPAW_METHOD:${method}`);
    const normalized = [...args]; while (normalized.length && normalized.at(-1) === undefined) normalized.pop();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (this.child?.connected) this.child.send({ kind: 'cancel', id }, () => {});
        this.pending.delete(id); signal?.removeEventListener('abort', abort);
        reject(new Error('CATPAW_REQUEST_CANCELLED'));
      };
      this.pending.set(id, { resolve, reject, clean: () => signal?.removeEventListener('abort', abort) });
      signal?.addEventListener('abort', abort, { once: true });
      this.child!.send({ kind: 'call', id, method, args: normalized, owner }, error => {
        if (!error) return;
        this.pending.get(id)?.clean(); this.pending.delete(id); reject(error);
      });
    });
  }
  release(owner: string) { if (this.child?.connected) this.child.send({ kind: 'release', owner }); }
  touch(owner: string) { if (this.child?.connected) this.child.send({ kind: 'touch', owner }, () => {}); }
  private async generateModel(raw: unknown, child: ChildProcess) {
    let id: string | undefined;
    try {
      const request = parseModelRequest(raw); id = request.id;
      if (!this.options.harnessModel || this.options.harnessModel.model !== request.model) throw new Error('HARNESS_MODEL_NOT_CONFIGURED');
      if (this.modelRequests.size >= 4 || this.modelRequests.has(id)) throw new Error('CATPAW_MODEL_BUSY');
      const controller = new AbortController(); this.modelRequests.set(id, controller);
      const timer = setTimeout(() => controller.abort(), 90_000);
      try {
        const text = await this.options.harnessModel.generate(request, controller.signal);
        controller.signal.throwIfAborted();
        if (typeof text !== 'string' || !text.trim() || text.length > 120000) throw new Error('INVALID_MODEL_OUTPUT');
        if (child.connected) child.send({ kind: 'model-response', id, ok: true, text }, () => {});
      } finally { clearTimeout(timer); this.modelRequests.delete(id); }
    } catch {
      if (child.connected && id) child.send({ kind: 'model-response', id, ok: false,
        error: 'Harness 模型调用未完成，请检查 Harness 的模型配置、连接和额度后重试。' }, () => {});
    }
  }
  async restart(): Promise<void> {
    if (this.disposed) throw new Error('CATPAW_STOPPED');
    if (this.restarting) return this.restarting;
    this.restarting = (async () => {
      await this.stopProcess();
      if (this.disposed) throw new Error('CATPAW_STOPPED');
      this.closed = false; this.closing = undefined; this.opening = undefined;
      await this.start();
      this.publish({ channel: 'rss:stateChanged', value: { scopes: ['subscriptions', 'entries', 'counts', 'jobs'] } });
    })();
    try { await this.restarting; } finally { this.restarting = undefined; }
  }
  private appendLog(text: string) { this.logs = (this.logs + text).slice(-4000); }
  private failPending(error: Error) {
    for (const pending of this.pending.values()) { pending.clean(); pending.reject(error); }
    this.pending.clear();
  }
  private publish(event: { owner?: string; channel: string; value: unknown }) {
    this.journal.push({ ...event, sequence: ++this.sequence });
    if (this.journal.length > 256) this.journal.shift();
    for (const notify of this.listeners) notify();
  }
  async events(owner: string, after: number, signal: AbortSignal) {
    if (this.restarting) await this.restarting;
    if (!this.closed) await this.start();
    signal.throwIfAborted(); this.touch(owner);
    const snapshot = () => ({ sequence: this.sequence, connected: Boolean(this.child?.connected && !this.closed), reset: after > this.sequence || after < (this.journal[0]?.sequence ?? 1) - 1,
      events: this.journal.filter(row => row.sequence > after && (!row.owner || row.owner === owner)) });
    if (this.sequence > after || this.closed) return snapshot();
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); this.listeners.delete(done); resolve(); };
      const timer = setTimeout(done, 20_000);
      signal.addEventListener('abort', done, { once: true }); this.listeners.add(done);
      if (signal.aborted) done();
    });
    return snapshot();
  }
  async close(): Promise<void> {
    this.disposed = true;
    await this.restarting?.catch(() => {});
    await this.stopProcess();
  }
  private async stopProcess(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; for (const notify of this.listeners) notify();
    for (const controller of this.modelRequests.values()) controller.abort();
    const child = this.child;
    this.closing = (async () => {
      if (child && child.exitCode === null) await new Promise<void>(resolve => {
        const timer = setTimeout(() => child.kill('SIGTERM'), 20_000);
        const lastResort = setTimeout(() => child.kill('SIGKILL'), 30_000);
        child.once('exit', () => { clearTimeout(timer); clearTimeout(lastResort); resolve(); });
        if (child.connected) child.send({ kind: 'shutdown' }, error => { if (error) child.kill('SIGTERM'); });
        else child.kill('SIGTERM');
      });
      this.failPending(new Error('CATPAW_STOPPED'));
    })().catch(error => { throw new Error(errorMessage(error)); });
    return this.closing;
  }
}
