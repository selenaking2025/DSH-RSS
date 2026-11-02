export const AUTOMATIC_BACKUP_INTERVAL_MS = 24 * 60 * 60_000;
export const AUTOMATIC_BACKUP_RETRY_MS = 60 * 60_000;
export const RETAINED_AUTOMATIC_BACKUPS = 7;

export type AutomaticBackupStatus = {
  enabled: boolean;
  directory: string;
  customDirectory: boolean;
  running: boolean;
  lastSuccessAt: number | null;
  lastBackupPath: string | null;
  lastError: string | null;
  nextBackupAt: number | null;
};
