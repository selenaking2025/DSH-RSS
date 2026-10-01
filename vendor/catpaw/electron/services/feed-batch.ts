/** A batch owns every branch until it settles, including failure and cancellation. */
export async function runFeedBatch<T extends { hostKey: string }>(
  feeds: T[], concurrency: number, perHostConcurrency: number,
  runFeed: (feed: T, shouldStop: () => boolean) => Promise<void>,
  cancelled: () => boolean = () => false,
) {
  const queue = [...feeds];
  const activeByHost = new Map<string, number>();
  const waiters = new Set<() => void>();
  let failed = false;
  let failure: unknown;
  const shouldStop = () => failed || cancelled();
  const wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  const take = () => {
    const index = queue.findIndex((feed) => (activeByHost.get(feed.hostKey) ?? 0) < perHostConcurrency);
    if (index < 0) return null;
    const [feed] = queue.splice(index, 1);
    activeByHost.set(feed.hostKey, (activeByHost.get(feed.hostKey) ?? 0) + 1);
    return feed;
  };
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, feeds.length || 1)) }, async () => {
    while (queue.length && !shouldStop()) {
      const feed = take();
      if (!feed) { await new Promise<void>((resolve) => waiters.add(resolve)); continue; }
      try {
        await runFeed(feed, shouldStop);
      } catch (error) {
        if (!failed) { failure = error; failed = true; }
      } finally {
        activeByHost.set(feed.hostKey, (activeByHost.get(feed.hostKey) ?? 1) - 1);
        wake();
      }
    }
  });
  await Promise.allSettled(workers);
  if (failed) throw failure;
}
