export type AppUpdatePhase = 'unavailable' | 'idle' | 'checking' | 'current' | 'available'
  | 'downloading' | 'installing' | 'error';
export type AppUpdateAction = 'check' | 'download' | 'install';
export type AppUpdateStatus = {
  revision: number;
  phase: AppUpdatePhase;
  currentVersion: string;
  version?: string;
  checkedAt?: number;
  progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number };
  message?: string;
  retry?: AppUpdateAction;
};
export type AppUpdateResult = { ok: boolean; error?: string };
