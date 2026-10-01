import type { AppUpdateAction, AppUpdateResult, AppUpdateStatus } from '../contracts/app-update';

export interface UpdateDriver {
  check(): Promise<{ version: string } | null>;
  download(onProgress: (progress: NonNullable<AppUpdateStatus['progress']>) => void): Promise<void>;
  prepareInstall(): Promise<void>;
  install(): void;
  cancel(): void;
}

/** A user-started update owns download, validation and restart as one operation. */
export class AppUpdates {
  private state: AppUpdateStatus;
  private listeners = new Set<(status: AppUpdateStatus) => void>();
  private operation: { action: AppUpdateAction; promise: Promise<AppUpdateResult> } | null = null;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private checkTimer?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(private readonly options: {
    version: string;
    driver?: UpdateDriver;
    unavailable?: string;
    prepareToQuit: () => Promise<void>;
    logError?: (error: unknown) => void;
  }) {
    this.state = { revision: 0, currentVersion: options.version, phase: options.driver ? 'idle' : 'unavailable', message: options.unavailable };
  }

  getStatus = (): AppUpdateStatus => structuredClone(this.state);
  subscribe(listener: (status: AppUpdateStatus) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  start() {
    if (!this.options.driver || this.stopped || this.startupTimer || this.checkTimer) return;
    const check = () => {
      if (!this.operation && (['idle', 'current'].includes(this.state.phase) || this.state.retry === 'check')) void this.check();
    };
    this.startupTimer = setTimeout(check, 30_000);
    this.checkTimer = setInterval(check, 6 * 60 * 60_000);
    this.startupTimer.unref(); this.checkTimer.unref();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.startupTimer); clearInterval(this.checkTimer);
    this.options.driver?.cancel();
  }

  check = (): Promise<AppUpdateResult> => {
    if (this.state.phase === 'available' && !this.operation) return Promise.resolve({ ok: true });
    return this.run('check', async (driver) => {
      this.change({ phase: 'checking', message: undefined, retry: undefined, progress: undefined, version: undefined });
      const update = await driver.check();
      if (!this.stopped) this.change({ phase: update ? 'available' : 'current', version: update?.version, checkedAt: Date.now() });
    });
  };

  download = (): Promise<AppUpdateResult> => {
    if (this.operation?.action === 'download') return this.operation.promise;
    if (this.state.phase !== 'available'
      && !(this.state.phase === 'error' && this.state.retry === 'download')) return Promise.resolve({ ok: false, error: '请先检查并选择可用的新版本。' });
    return this.run('download', async (driver) => {
      this.change({ phase: 'downloading', message: undefined, retry: undefined, progress: undefined });
      await driver.download((progress) => {
        if (this.stopped || this.state.phase !== 'downloading') return;
        const nonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
        this.change({ progress: { percent: Math.min(100, nonnegative(progress.percent)), transferred: nonnegative(progress.transferred),
          total: nonnegative(progress.total), bytesPerSecond: nonnegative(progress.bytesPerSecond) } });
      });
      if (!this.stopped) await this.installDownloaded(driver);
    });
  };

  install = (): Promise<AppUpdateResult> => {
    if (this.operation?.action === 'install') return this.operation.promise;
    if (!(this.state.phase === 'error' && this.state.retry === 'install')) return Promise.resolve({ ok: false, error: '请先下载更新。' });
    return this.run('install', (driver) => this.installDownloaded(driver));
  };

  private async installDownloaded(driver: UpdateDriver) {
    this.change({ phase: 'installing', message: '正在校验更新…', retry: undefined, progress: undefined });
    // Stage and validate before retiring workers. A rejected signature leaves
    // the reader running; renderer lifetime cannot interrupt a successful update.
    await driver.prepareInstall();
    if (this.stopped) return;
    this.change({ message: '正在保存数据，即将重启…' });
    await this.options.prepareToQuit();
    driver.install();
  }

  private run(action: AppUpdateAction, task: (driver: UpdateDriver) => Promise<void>): Promise<AppUpdateResult> {
    if (this.stopped) return Promise.resolve({ ok: false, error: '应用正在退出，请稍后重试。' });
    if (!this.options.driver) return Promise.resolve({ ok: false, error: this.state.message ?? '此版本暂不支持自动更新。' });
    if (this.operation) return this.operation.action === action ? this.operation.promise
      : Promise.resolve({ ok: false, error: '请等待当前更新操作完成。' });
    const promise = Promise.resolve().then(() => task(this.options.driver!)).then(() => ({ ok: true }), (error: unknown) => {
      this.options.logError?.(error);
      const retry = this.state.phase === 'installing' ? 'install' : action;
      const message = retry === 'check' ? '无法检查更新，请检查网络连接后重试。'
        : retry === 'download' ? '下载或校验失败，请检查网络及磁盘空间后重试。'
          : '未能安装更新，请重试；若仍失败，可重新打开应用后下载更新。';
      if (!this.stopped) this.change({ phase: 'error', message, retry, progress: undefined });
      return { ok: false, error: message };
    }).finally(() => { this.operation = null; });
    this.operation = { action, promise };
    return promise;
  }

  private change(patch: Partial<AppUpdateStatus>) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener(this.getStatus());
  }
}
