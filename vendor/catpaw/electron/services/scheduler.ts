import { powerMonitor } from 'electron';
import { rssJobManager } from '../rss-job-manager';
import { advanceIntervalFeedSchedules, findNextDailyRefreshAt, getLastHandledDailySlotAt,
  getNextIntervalRefreshAt, getRefreshSettings, listDueIntervalFeedIds, setLastHandledDailySlotAt } from '../data/refresh-settings-repo';
import { runDueScheduledRefreshes as runDueScheduledRefreshesWith, type ScheduledRefreshReason } from './scheduled-refresh-service';
import { runWithStorageWriteRetry } from './sqlite-retry';
let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledWakeRunning = false;
let stopped = false;
export function stopSchedulers() { stopped = true; if (autoRefreshTimer) clearTimeout(autoRefreshTimer); }
export function scheduleNextScheduledRefresh(fromTime = Date.now()) {
  if (stopped) return;
  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  const settings = getRefreshSettings();
  if (!settings.enabled) {
    rssJobManager.setNextRefreshAt(null);
    return;
  }
  const nextDailyAt = findNextDailyRefreshAt(fromTime, settings.dailyTime);
  const nextIntervalAt = getNextIntervalRefreshAt();
  const nextRefreshAt = nextIntervalAt === null ? nextDailyAt : Math.min(nextDailyAt, nextIntervalAt);
  rssJobManager.setNextRefreshAt(nextRefreshAt);
  const delayMs = Math.max(500, nextRefreshAt - Date.now());
  autoRefreshTimer = setTimeout(() => {
    autoRefreshTimer = null;
    rssJobManager.setNextRefreshAt(null);
    void runDueScheduledRefreshes('timer');
  }, delayMs);
}

async function enqueueScheduledRefresh(input: {
  feedIds?: string[];
  scheduledAt: number;
  reason: 'timer' | 'startup' | 'resume' | 'settings_update';
  scheduleKind: 'daily' | 'interval';
}) {
  await rssJobManager.enqueue({
    kind: 'refresh_all',
    trigger: 'scheduled',
    options: {
      ...(input.feedIds ? { feedIds: input.feedIds } : {}),
      refreshConcurrency: 6,
      perHostConcurrency: 1,
    },
    metadata: {
      scheduledSlotAt: input.scheduledAt,
      scheduledReason: input.reason,
      scheduleKind: input.scheduleKind,
    },
  });
}

export async function runDueScheduledRefreshes(reason: ScheduledRefreshReason) {
  if (scheduledWakeRunning) return;
  scheduledWakeRunning = true;
  try {
    await runDueScheduledRefreshesWith({
      now: Date.now(),
      reason,
      settings: getRefreshSettings(),
      getLastHandledDailySlotAt,
      setLastHandledDailySlotAt: (at) => runWithStorageWriteRetry('dailySchedule', () => { setLastHandledDailySlotAt(at); }),
      listDueIntervalFeedIds,
      advanceIntervalFeedSchedules: (ids, at) => runWithStorageWriteRetry('intervalSchedule', () => { advanceIntervalFeedSchedules(ids, at); }),
      enqueueScheduledRefresh,
      onError: (message, error) => console.error(message, error),
    });
  } finally {
    scheduledWakeRunning = false;
    scheduleNextScheduledRefresh();
  }
}

export function registerSchedulers() {
  void runDueScheduledRefreshes('startup');

  powerMonitor.on('resume', () => {
    void runDueScheduledRefreshes('resume');
  });
}
