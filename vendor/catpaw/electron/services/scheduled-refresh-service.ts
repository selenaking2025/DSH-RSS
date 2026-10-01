import type { RefreshSettings } from '../data/refresh-settings-repo';
import { createDailySlotTimestamp, findMostRecentDailyRefreshAt } from '../data/refresh-settings-repo';

export type ScheduledRefreshReason = 'timer' | 'startup' | 'resume' | 'settings_update';

export type ScheduledRefreshEnqueueInput = {
  feedIds?: string[];
  scheduledAt: number;
  reason: ScheduledRefreshReason;
  scheduleKind: 'daily' | 'interval';
};

export type ScheduledRefreshDeps = {
  now: number;
  reason: ScheduledRefreshReason;
  settings: RefreshSettings;
  getLastHandledDailySlotAt: () => number | null;
  setLastHandledDailySlotAt: (slotAt: number) => void | Promise<void>;
  listDueIntervalFeedIds: (now: number) => string[];
  advanceIntervalFeedSchedules: (feedIds: string[], fromTime: number) => void | Promise<void>;
  enqueueScheduledRefresh: (input: ScheduledRefreshEnqueueInput) => Promise<unknown>;
  onError?: (message: string, error: unknown) => void;
  /** Injected so the interval schedule can be advanced from the real completion time. */
  clock?: () => number;
};

export type ScheduledRefreshOutcome = {
  dailySlotAt: number | null;
  dailyEnqueued: boolean;
  dailySlotConsumed: boolean;
  intervalFeedIds: string[];
  intervalEnqueued: boolean;
  intervalSchedulesAdvanced: boolean;
};

/**
 * Decides which scheduled work is due and runs it, consuming the bookkeeping only
 * after the work is actually queued. Marking a slot handled up front meant a failed
 * enqueue silently burned that slot: the daily refresh was skipped until the next
 * day, and interval feeds jumped a whole period.
 *
 * Effects are injected so this stays testable without an Electron app.
 */
export async function runDueScheduledRefreshes(deps: ScheduledRefreshDeps): Promise<ScheduledRefreshOutcome> {
  const outcome: ScheduledRefreshOutcome = {
    dailySlotAt: null,
    dailyEnqueued: false,
    dailySlotConsumed: false,
    intervalFeedIds: [],
    intervalEnqueued: false,
    intervalSchedulesAdvanced: false,
  };

  if (!deps.settings.enabled) return outcome;

  const clock = deps.clock ?? (() => Date.now());
  const recentDailySlotAt = findMostRecentDailyRefreshAt(deps.now, deps.settings.dailyTime);
  const todayDailySlotAt = createDailySlotTimestamp(new Date(deps.now), deps.settings.dailyTime);
  const lastHandledSlotAt = deps.getLastHandledDailySlotAt();
  const dailySlotIsDue = recentDailySlotAt > (lastHandledSlotAt ?? 0);
  // A timer tick is the slot firing on time. Anything else is a catch-up, which the
  // user can restrict to slots from today.
  const canCatchUpDaily = deps.reason === 'timer'
    || (deps.settings.catchUpMissed && recentDailySlotAt === todayDailySlotAt);

  if (dailySlotIsDue) {
    outcome.dailySlotAt = recentDailySlotAt;
    if (!canCatchUpDaily) {
      // Deliberately skipped, so the slot is spent rather than retried forever.
      await deps.setLastHandledDailySlotAt(recentDailySlotAt);
      outcome.dailySlotConsumed = true;
    } else {
      try {
        await deps.enqueueScheduledRefresh({
          scheduledAt: recentDailySlotAt,
          reason: deps.reason,
          scheduleKind: 'daily',
        });
        await deps.setLastHandledDailySlotAt(recentDailySlotAt);
        outcome.dailyEnqueued = true;
        outcome.dailySlotConsumed = true;
      } catch (error) {
        deps.onError?.(
          `[rss] daily scheduled refresh failed for ${new Date(recentDailySlotAt).toISOString()}; slot stays due`,
          error,
        );
      }
    }
  }

  const dueFeedIds = deps.listDueIntervalFeedIds(deps.now);
  outcome.intervalFeedIds = dueFeedIds;
  if (dueFeedIds.length === 0) return outcome;

  const shouldRunIntervalFeeds = deps.reason === 'timer' || deps.settings.catchUpMissed;
  if (!shouldRunIntervalFeeds) {
    await deps.advanceIntervalFeedSchedules(dueFeedIds, clock());
    outcome.intervalSchedulesAdvanced = true;
    return outcome;
  }

  try {
    await deps.enqueueScheduledRefresh({
      feedIds: dueFeedIds,
      scheduledAt: deps.now,
      reason: deps.reason,
      scheduleKind: 'interval',
    });
    // Advance from completion time so a run that outlasts its own interval does not
    // leave the feed instantly due again.
    await deps.advanceIntervalFeedSchedules(dueFeedIds, clock());
    outcome.intervalEnqueued = true;
    outcome.intervalSchedulesAdvanced = true;
  } catch (error) {
    deps.onError?.(`[rss] interval refresh failed for ${dueFeedIds.length} feeds; they stay due`, error);
  }

  return outcome;
}
