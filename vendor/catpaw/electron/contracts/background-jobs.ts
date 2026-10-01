export type BackgroundJobPriority = 'critical' | 'interactive' | 'scheduled' | 'background';

export const BACKGROUND_JOB_PRIORITY_WEIGHT: Record<BackgroundJobPriority, number> = {
  critical: 400,
  interactive: 300,
  scheduled: 200,
  background: 100,
};

export type BackgroundJobFailure = {
  requestId: string;
  priority: BackgroundJobPriority;
  message: string;
  failedAt: number;
};

export type BackgroundJobQueueStats = Record<BackgroundJobPriority, number>;

export function createBackgroundJobQueueStats(): BackgroundJobQueueStats {
  return {
    critical: 0,
    interactive: 0,
    scheduled: 0,
    background: 0,
  };
}
