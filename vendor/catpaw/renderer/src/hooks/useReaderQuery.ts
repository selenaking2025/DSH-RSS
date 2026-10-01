import { useCallback, useSyncExternalStore } from 'react';

type Snapshot<T> = { data: T; loading: boolean; error: string | null };
type Query<T> = { snapshot: Snapshot<T>; load: () => Promise<T>; listeners: Set<() => void>; pending: boolean; dirty: boolean };
const queries = new Map<string, Query<unknown>>();
let stopEvents: (() => void) | undefined;
let fallback: ReturnType<typeof setInterval> | undefined;

async function refresh<T>(query: Query<T>) {
  if (query.pending) { query.dirty = true; return; }
  query.pending = true;
  try {
    const data = await query.load();
    query.snapshot = { data, loading: false, error: null };
  } catch (error) {
    query.snapshot = { ...query.snapshot, loading: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    query.pending = false;
    for (const notify of query.listeners) notify();
    if (query.dirty && query.listeners.size) { query.dirty = false; void refresh(query); }
  }
}

function refreshActive() {
  for (const query of queries.values()) if (query.listeners.size) void refresh(query);
}

/** One shared subscription and a slow recovery poll, retaining last known data on error. */
export function useReaderQuery<T>(key: string, load: () => Promise<T>, initial: T, enabled = true) {
  if (!queries.has(key)) queries.set(key, { snapshot: { data: initial, loading: true, error: null }, load, listeners: new Set(), pending: false, dirty: false });
  const query = queries.get(key)! as Query<T>;
  query.load = load;
  const subscribe = useCallback((notify: () => void) => {
    if (!enabled) return () => {};
    query.listeners.add(notify);
    if (!fallback) {
      stopEvents = window.catpaw?.rss.onStateChanged((change) => { if (change.scopes.includes('jobs')) refreshActive(); });
      fallback = setInterval(refreshActive, 30_000);
    }
    void refresh(query);
    return () => {
      query.listeners.delete(notify);
      if (![...queries.values()].some((entry) => entry.listeners.size)) {
        stopEvents?.(); stopEvents = undefined;
        clearInterval(fallback); fallback = undefined;
      }
    };
  }, [enabled, query]);
  return useSyncExternalStore(subscribe, () => query.snapshot);
}
