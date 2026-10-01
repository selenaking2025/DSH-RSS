import { useCallback, useEffect, useRef, useState } from 'react';
import type { RssBridge } from '../../../../electron/contracts/rss';
import type { RssRunOutcome } from '../../../../electron/contracts/feed-run';
import { presentRun, type RunStatus } from './run-results';

type Kind = 'refresh' | 'backfill';
type Options = {
  activeFeedId: string | null;
  activeSchedulerJob: Awaited<ReturnType<RssBridge['getSchedulerStatus']>>['currentJob'];
  clearError: () => void;
  reportError: (title: string, error?: unknown) => void;
  loadFeedTree: () => Promise<void>;
  loadUnreadCounts: () => Promise<void>;
  loadSmartCounts: () => Promise<void>;
  loadEntries: () => Promise<void>;
};

export function useReaderJobs(options: Options) {
  const { activeFeedId, activeSchedulerJob, clearError, reportError,
    loadFeedTree, loadUnreadCounts, loadSmartCounts, loadEntries } = options;
  const [jobs, setJobs] = useState<Partial<Record<Kind, RunStatus>>>({});
  const owner = useRef<Partial<Record<Kind, { kind: Kind; cancelled: boolean }>>>({});
  const timeout = useRef<Partial<Record<Kind, ReturnType<typeof setTimeout>>>>({});
  const setJob = (kind: Kind, next: RunStatus | ((previous: RunStatus | undefined) => RunStatus | undefined)) =>
    setJobs((previous) => ({ ...previous, [kind]: typeof next === 'function' ? next(previous[kind]) : next }));
  const activeRefreshJob = activeSchedulerJob?.kind.startsWith('refresh') ? activeSchedulerJob : null;
  const activeBackfillJob = activeSchedulerJob?.kind.startsWith('backfill') ? activeSchedulerJob : null;
  const running = (kind: Kind) => jobs[kind]?.phase === 'running' || jobs[kind]?.phase === 'stopping';

  useEffect(() => () => {
    owner.current = {};
    for (const timer of Object.values(timeout.current)) clearTimeout(timer);
  }, []);

  const start = useCallback(async (kind: Kind, feedIds?: string[]) => {
    const rss = window.catpaw?.rss;
    if (!rss || owner.current[kind] || (activeSchedulerJob && !(kind === 'refresh' && activeSchedulerJob.kind.startsWith('backfill')))) return;
    const run = { kind, cancelled: false };
    owner.current[kind] = run;
    clearTimeout(timeout.current[kind]);
    clearError();
    setJob(kind, { phase: 'running', total: feedIds?.length ?? 0, done: 0, scannedItems: 0, historyIncapable: 0 });
    try {
      const ids = Array.from(new Set(feedIds ?? (await rss.listFeeds()).filter((feed) => feed.enabled !== 0).map((feed) => feed.id)));
      if (owner.current[kind] !== run) return;
      setJob(kind, (previous) => previous && { ...previous, total: ids.length });
      // Cancellation while resolving the target list must never dispatch new work.
      let result: RssRunOutcome;
      if (run.cancelled) result = { status: 'cancelled', runId: null, feeds: [],
        failure: { error: 'CANCELLED', errorKind: 'cancelled' },
        progress: { total: ids.length, done: 0, succeeded: 0, failed: 0, newEntries: 0 } };
      else result = kind === 'refresh' ? await rss.refreshAll({ feedIds: ids }) : await rss.backfillAll({ feedIds: ids });
      if (owner.current[kind] !== run) return;
      // These reads are independent; loadEntries always owns the current selection.
      await Promise.all([loadFeedTree(), loadUnreadCounts(), loadSmartCounts(), loadEntries()]);
      if (owner.current[kind] !== run) return;
      setJob(kind, presentRun(result));
      if (result.status === 'failed') reportError(kind === 'refresh' ? '刷新未完成' : '历史回补未完成', result.failure.error);
    } catch (error) {
      if (owner.current[kind] !== run) return;
      setJob(kind, (previous) => previous && { ...previous, phase: 'failed' });
      reportError(kind === 'refresh' ? '刷新订阅源失败' : '历史回补失败', error);
    } finally {
      if (owner.current[kind] === run) {
        delete owner.current[kind];
        timeout.current[kind] = setTimeout(() => setJobs((previous) => ({ ...previous, [kind]: undefined })), kind === 'refresh' ? 3000 : 6000);
      }
    }
  }, [activeSchedulerJob, clearError, loadEntries, loadFeedTree, loadSmartCounts, loadUnreadCounts, reportError]);

  const handleCancelActiveJobs = useCallback(async () => {
    const runs = Object.values(owner.current);
    for (const run of runs) {
      run.cancelled = true;
      setJob(run.kind, (previous) => previous && { ...previous, phase: 'stopping' });
    }
    try { await window.catpaw?.rss.cancelActiveJobs(); }
    catch (error) {
      for (const run of runs) {
        if (owner.current[run.kind] !== run) continue;
        run.cancelled = false;
        setJob(run.kind, (previous) => previous && { ...previous, phase: 'running' });
      }
      reportError('停止失败', error);
    }
  }, [reportError]);

  return {
    activeRefreshJob, activeBackfillJob,
    refreshBusy: Boolean(activeRefreshJob || running('refresh')),
    backfillBusy: Boolean(activeBackfillJob || running('backfill')),
    refreshStatus: jobs.refresh ?? null,
    backfillStatus: jobs.backfill ?? null,
    handleCancelActiveJobs,
    handleRefresh: () => start('refresh'),
    handleBackfill: () => start('backfill', activeFeedId ? [activeFeedId] : undefined),
    startRefresh: (ids?: string[]) => start('refresh', ids),
    startInitialHistorySync: (ids: string[]) => start('backfill', ids),
  };
}
