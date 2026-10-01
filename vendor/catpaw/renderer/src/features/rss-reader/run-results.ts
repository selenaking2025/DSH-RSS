import type { RssRunOutcome } from '../../../../electron/contracts/feed-run';

export type RunStatus = {
  phase: 'running' | 'stopping' | RssRunOutcome['status'];
  done: number;
  total: number;
  scannedItems: number;
  historyIncapable: number;
};

export function presentRun(result: RssRunOutcome): RunStatus {
  return { phase: result.status, done: result.progress.done, total: result.progress.total,
    scannedItems: result.feeds.reduce((sum, feed) => sum + (feed.scannedItems ?? 0), 0),
    historyIncapable: result.feeds.filter((feed) => feed.ok && feed.historyCapable === false).length };
}
