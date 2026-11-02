import { AUTOMATIC_BACKUP_INTERVAL_MS, AUTOMATIC_BACKUP_RETRY_MS, type AutomaticBackupStatus } from '../contracts/automatic-backup';
import type { AutomaticBackupSettings } from '../data/automatic-backup-settings';

type Dependencies = {
  read: () => AutomaticBackupSettings;
  save: (settings: AutomaticBackupSettings) => void;
  defaultDirectory: () => string;
  backup: (input: { id: string; directory: string | null }) => Promise<{ filePath: string }>;
  now?: () => number;
};

export class AutomaticBackupService {
  private settings?: AutomaticBackupSettings;
  private active: Promise<void> | null = null;
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly dependencies: Dependencies) {}
  private now() { return this.dependencies.now?.() ?? Date.now(); }
  private read() { return this.settings ??= this.dependencies.read(); }
  private save(settings: AutomaticBackupSettings) {
    this.dependencies.save(settings);
    this.settings = settings;
  }
  private dueAt(settings: AutomaticBackupSettings) {
    const now = this.now();
    // A clock moved backwards must not suppress backups indefinitely.
    const next = settings.lastSuccessAt === null || settings.lastSuccessAt > now
      ? now : settings.lastSuccessAt + AUTOMATIC_BACKUP_INTERVAL_MS;
    const retry = settings.lastAttemptAt === null || settings.lastAttemptAt > now
      ? now : settings.lastAttemptAt + AUTOMATIC_BACKUP_RETRY_MS;
    return settings.lastError ? retry : next;
  }
  getStatus(): AutomaticBackupStatus {
    const settings = this.read();
    return { enabled: settings.enabled, directory: settings.directory ?? this.dependencies.defaultDirectory(),
      customDirectory: settings.directory !== null, running: this.active !== null,
      lastSuccessAt: settings.lastSuccessAt, lastBackupPath: settings.lastBackupPath,
      lastError: settings.lastError, nextBackupAt: settings.enabled ? this.dueAt(settings) : null };
  }
  configure(input: { enabled?: boolean; directory?: string | null }) {
    if (this.stopped) throw new Error('APP_QUITTING');
    if (this.active) throw new Error('AUTOMATIC_BACKUP_BUSY');
    const settings = this.read();
    const changedDirectory = input.directory !== undefined && input.directory !== settings.directory;
    this.save({ ...settings, ...input, ...(changedDirectory ? {
      lastSuccessAt: null, lastBackupPath: null, lastAttemptAt: null, lastError: null,
    } : {}) });
    this.wake();
    return this.getStatus();
  }
  runDue(force = false): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('APP_QUITTING'));
    if (this.active) return this.active;
    const settings = this.read();
    if (!force && (!settings.enabled || this.dueAt(settings) > this.now())) return Promise.resolve();
    this.active = Promise.resolve().then(async () => {
      if (this.stopped) return;
      try {
        this.save({ ...settings, lastAttemptAt: this.now() });
        const result = await this.dependencies.backup({ id: settings.id, directory: settings.directory });
        this.save({ ...this.read(), lastSuccessAt: this.now(), lastBackupPath: result.filePath, lastError: null });
      } catch (error) {
        if (!this.stopped) {
          const failed = { ...this.read(), lastAttemptAt: this.now(), lastError: '自动备份未完成，请检查备份目录是否可用以及磁盘空间。' };
          // A full/read-only local disk can also prevent saving the failure record.
          // Keep a visible in-memory failure and backoff without reporting success.
          this.settings = failed;
          try { this.save(failed); }
          catch (saveError) { console.warn('[backup] Could not save backup status', saveError); }
        }
        throw error;
      }
    }).finally(() => { this.active = null; });
    return this.active;
  }
  wake = () => {
    if (this.stopped) return;
    // This also catches configuration/storage errors without disrupting startup/resume.
    void Promise.resolve().then(() => this.runDue()).catch((error) => console.warn('[backup] Automatic backup failed', error));
  };
  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(this.wake, 15 * 60_000);
    this.timer.unref();
    this.wake();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.active?.catch(() => {});
  }
}
