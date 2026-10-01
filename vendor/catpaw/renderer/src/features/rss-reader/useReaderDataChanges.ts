import { useEffect, useRef } from 'react';
import type { ReaderDataScope } from '../../../../electron/contracts/reader-events';

/** Coalesce committed changes; one in-flight reload per view, always using its latest scope. */
export function useReaderDataChanges(loaders: Record<ReaderDataScope, () => Promise<unknown>>) {
  const latest = useRef(loaders);
  latest.current = loaders;
  useEffect(() => {
    let stopped = false, running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<ReaderDataScope>();
    const flush = async () => {
      timer = undefined;
      if (stopped || running) return;
      running = true;
      const scopes = [...pending]; pending.clear();
      await Promise.allSettled(scopes.map((scope) => latest.current[scope]()));
      running = false;
      if (!stopped && pending.size) timer = setTimeout(flush, 100);
    };
    const unsubscribe = window.catpaw?.rss.onStateChanged((change) => {
      for (const scope of change.scopes) if (scope !== 'jobs') pending.add(scope);
      if (pending.size && !running && !timer) timer = setTimeout(flush, 100);
    });
    return () => { stopped = true; clearTimeout(timer); unsubscribe?.(); };
  }, []);
}
