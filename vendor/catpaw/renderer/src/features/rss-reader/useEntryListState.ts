import { useCallback, useEffect, useRef, useState } from 'react';
import { ENTRY_LIST_LIMIT } from './constants';
import type { Entry, SmartFeedId } from './types';
import type { RssBridge } from '../../../../electron/contracts/rss';
import { startOfToday, toEntryPreview } from './utils';
import { useRequestScope } from './useRequestScope';

type UseEntryListStateOptions = {
  activeFeedId: string | null;
  activeSmart: SmartFeedId;
  search: string;
  scopeReady: boolean;
  reportError: (title: string, error?: unknown) => void;
};
type LoadOptions = { append?: boolean; preserve?: boolean };
const recency = (entry: Entry) => [entry.publishedAt ?? entry.createdAt ?? 0, entry.createdAt ?? 0, entry.id] as const;
function compareEntries(a: Entry, b: Entry) {
  const left = recency(a), right = recency(b);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i] ? -1 : 1;
  return 0;
}

export function useEntryListState(options: UseEntryListStateOptions) {
  const { activeFeedId, activeSmart, search, scopeReady, reportError } = options;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesHasMore, setEntriesHasMore] = useState(false);
  const [loadingMoreEntries, setLoadingMoreEntries] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const entriesRef = useRef<Entry[]>([]);
  const loadedScopeKeyRef = useRef<string | null>(null);
  const scopeKey = `${activeFeedId ? `feed:${activeFeedId}` : `smart:${activeSmart}`}|search:${search.trim()}`;
  const beginRequest = useRequestScope(scopeKey);
  const selectedRef = useRef(selectedEntryId);
  selectedRef.current = selectedEntryId;

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const loadCurrentScope = useCallback(async (options?: LoadOptions) => {
    if (!window.catpaw || !scopeReady) return;
    // Picks have their own result owner. Ordinary refreshes must not replace
    // their selection with an article from the chronological list.
    if (!activeFeedId && activeSmart === 'selected') {
      if (loadedScopeKeyRef.current !== scopeKey) {
        loadedScopeKeyRef.current = scopeKey;
        setEntries([]);
        setSelectedEntryId(null);
        setEntriesHasMore(false);
        setLoading(false);
        setLoadingMoreEntries(false);
      }
      return;
    }
    const append = Boolean(options?.append);
    const preserve = Boolean(options?.preserve && loadedScopeKeyRef.current === scopeKey);
    const previousTail = preserve ? entriesRef.current[entriesRef.current.length - 1] : null;
    if (append && loadedScopeKeyRef.current !== scopeKey) return;
    const current = beginRequest();
    if (!preserve) {
      setLoadingMoreEntries(append);
      setLoading(!append);
      if (!append) setEntriesHasMore(false);
    }
    try {
      const params: Parameters<RssBridge['listEntries']>[0] = {
        mode: 'list',
        limit: ENTRY_LIST_LIMIT + 1,
      };
      const tail = append ? entriesRef.current[entriesRef.current.length - 1] : null;
      if (tail?.createdAt !== undefined) params.cursor = { id: tail.id, createdAt: tail.createdAt, sortAt: tail.publishedAt ?? tail.createdAt };
      if (search) {
        params.search = search;
      }

      if (activeFeedId) {
        params.feedId = activeFeedId;
      } else {
        if (activeSmart === 'unread') params.onlyUnread = true;
        if (activeSmart === 'starred') params.onlyStarred = true;
        if (activeSmart === 'today') params.since = startOfToday();
      }

      let nextEntries: Entry[] = [], hasMore = false;
      do {
        const data = await window.catpaw.rss.listEntries(params);
        if (!current()) return;
        nextEntries.push(...data.slice(0, ENTRY_LIST_LIMIT));
        hasMore = data.length > ENTRY_LIST_LIMIT;
        if (previousTail) {
          const boundary = nextEntries.findIndex((entry) => compareEntries(entry, previousTail) >= 0);
          if (boundary >= 0) {
            hasMore ||= boundary + 1 < nextEntries.length;
            nextEntries = nextEntries.slice(0, boundary + 1);
            break;
          }
        }
        const last = nextEntries[nextEntries.length - 1];
        if (!previousTail || !hasMore || !last) break;
        params.cursor = { id: last.id, createdAt: last.createdAt!, sortAt: last.publishedAt ?? last.createdAt! };
      } while (current());
      // A read/star change may exclude the article currently being read. Keep it
      // pinned while it exists; never auto-select its successor on a background update.
      const selectedId = preserve ? selectedRef.current : null;
      if (selectedId && !nextEntries.some((entry) => entry.id === selectedId)) {
        const pinned = await window.catpaw.rss.getEntry(selectedId);
        if (!current()) return;
        if (pinned && selectedRef.current === selectedId) nextEntries.push(toEntryPreview(pinned));
        nextEntries.sort(compareEntries);
      }
      setEntriesHasMore(hasMore);
      setEntries((prev) => {
        if (!append) return nextEntries;
        const seen = new Set(prev.map((item) => item.id));
        const merged = [...prev];
        for (const item of nextEntries) {
          if (seen.has(item.id)) continue;
          merged.push(item);
        }
        return merged;
      });
      if (!append) {
        loadedScopeKeyRef.current = scopeKey;
        setSelectedEntryId((prev) => {
          if (prev && nextEntries.some((item) => item.id === prev)) return prev;
          if (preserve) return null;
          if (nextEntries.length === 0) return null;
          return nextEntries[0].id;
        });
      }
    } catch (error) {
      if (!current()) return;
      reportError('载入文章失败', error);
    } finally {
      if (current()) {
        setLoadingMoreEntries(false);
        setLoading(false);
      }
    }
  }, [activeFeedId, activeSmart, reportError, scopeKey, scopeReady, search, beginRequest]);

  // A refresh started in another selection must reload the currently visible scope.
  const latestLoad = useRef(loadCurrentScope);
  latestLoad.current = loadCurrentScope;
  const loadEntries = useCallback((options?: LoadOptions) => latestLoad.current(options), []);
  const reloadEntries = useCallback(() => latestLoad.current({ preserve: true }), []);

  useEffect(() => {
    if (!scopeReady) return;
    void loadEntries();
  }, [loadEntries, scopeKey, scopeReady]);

  const handleLoadMoreEntries = useCallback(async () => {
    if (!entriesHasMore || loadingMoreEntries || loading) return;
    await loadEntries({ append: true });
  }, [entriesHasMore, loading, loadingMoreEntries, loadEntries]);

  return {
    entries: loadedScopeKeyRef.current === scopeKey ? entries : [],
    setEntries,
    entriesHasMore,
    loadingMoreEntries,
    loading,
    selectedEntryId: loadedScopeKeyRef.current === scopeKey ? selectedEntryId : null,
    setSelectedEntryId,
    entriesRef,
    loadEntries,
    reloadEntries,
    handleLoadMoreEntries,
  };
}
