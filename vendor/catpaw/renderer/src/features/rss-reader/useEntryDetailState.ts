import { useEntryAnalysis } from './useEntryAnalysis';
import { useRequestScope } from './useRequestScope';
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { FAILED_FETCH_RETRY_MS, FETCHING_COOLDOWN_MS } from './constants';
import type { Entry, SmartCounts, SocialThreadItem } from './types';
import { getEntryContentLength, resolveEntryTweetId, resolveVideoEmbedFromLink, toEntryPreview, startOfToday } from './utils';

type UseEntryDetailStateOptions = {
  selectedEntryId: string | null;
  summaryModelKey: string;
  setEntries: Dispatch<SetStateAction<Entry[]>>;
  entriesRef: MutableRefObject<Entry[]>;
  setUnreadCounts: Dispatch<SetStateAction<Record<string, number>>>;
  setSmartCounts: Dispatch<SetStateAction<SmartCounts>>;
  loadEntries: (options?: { append?: boolean }) => Promise<void>;
  loadFeeds: () => Promise<void>;
  loadSmartCounts: () => Promise<void>;
  reportError: (title: string, error?: unknown) => void;
};

export function useEntryDetailState(options: UseEntryDetailStateOptions) {
  const {
    selectedEntryId,
    setEntries,
    entriesRef,
    setUnreadCounts,
    setSmartCounts,
    loadEntries,
    loadFeeds,
    loadSmartCounts,
    reportError,
  } = options;
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [fetchingContent, setFetchingContent] = useState(false);
  const { entryAnalysis, analyzingEntry, handleAnalyzeEntry: generateSummary, handleCancelAnalysis } = useEntryAnalysis(selectedEntryId, selectedEntry, reportError, options.summaryModelKey);
  const [videoStartAt, setVideoStartAt] = useState<number | null>(null);
  const [socialThread, setSocialThread] = useState<SocialThreadItem[] | null>(null);
  const [loadingSocialThread, setLoadingSocialThread] = useState(false);
  const selectedEntryRef = useRef<Entry | null>(null);
  const requestedFullContentRef = useRef(new Set<string>());
  const requestedXiaoyuzhouAudioRef = useRef(new Set<string>());
  const pendingReadSyncRef = useRef(new Set<string>());
  const beginDetailRequest = useRequestScope(selectedEntryId);
  const beginContentRequest = useRequestScope(selectedEntryId);
  const mediaPlayerRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => {
    selectedEntryRef.current = selectedEntry;
  }, [selectedEntry]);

  const shouldExtractFullContent = useCallback((entry: Entry | null | undefined) => {
    if (!entry?.link) return false;
    const contentLength = getEntryContentLength(entry);
    if (contentLength >= 400) return false;

    const attemptedAt = typeof entry.contentFetchAttemptedAt === 'number' ? entry.contentFetchAttemptedAt : null;
    const now = Date.now();
    switch (entry.contentFetchStatus) {
      case 'fetched':
      case 'no_content':
      case 'auth_required':
        return false;
      case 'fetching':
        return !attemptedAt || now - attemptedAt > FETCHING_COOLDOWN_MS;
      case 'failed':
        return !attemptedAt || now - attemptedAt > FAILED_FETCH_RETRY_MS;
      default:
        return true;
    }
  }, []);

  const updateEntryPreview = useCallback((entryId: string, patch: Partial<Entry>) => {
    setEntries((prev) => prev.map((item) => (item.id === entryId ? { ...item, ...patch } : item)));
    setSelectedEntry((prev) => (prev?.id === entryId ? { ...prev, ...patch } : prev));
  }, [setEntries]);

  const mergeEntrySnapshot = useCallback((entry: Entry | null) => {
    if (!entry?.id) return;
    const preview = toEntryPreview(entry);
    setEntries((prev) => prev.map((item) => (item.id === preview.id ? { ...item, ...preview } : item)));
    setSelectedEntry((prev) => (prev?.id === preview.id ? { ...prev, ...entry } : prev));
  }, [setEntries]);

  const applyReadStateLocally = useCallback((entry: Entry) => {
    if (!entry.id || entry.isRead !== 0) return;

    // Keep the article being read in place until the user changes scope or refreshes.
    // Removing it and selecting its successor would mark the entire unread list read.
    selectedEntryRef.current = { ...entry, isRead: 1 };
    updateEntryPreview(entry.id, { isRead: 1 });

    if (entry.feedId) {
      setUnreadCounts((prev) => {
        const current = prev[entry.feedId] ?? 0;
        if (current <= 0) return prev;
        return { ...prev, [entry.feedId]: current - 1 };
      });
    }
    setSmartCounts((prev) => ({
      ...prev,
      unread: Math.max(0, (prev.unread ?? 0) - 1),
      todayUnread: Math.max(0, prev.todayUnread - ((entry.publishedAt ?? entry.createdAt ?? 0) >= startOfToday() ? 1 : 0)),
    }));
  }, [setSmartCounts, setUnreadCounts, updateEntryPreview]);

  const syncReadStateInBackground = useCallback((entryId: string) => {
    if (!window.catpaw || !entryId || pendingReadSyncRef.current.has(entryId)) return;
    pendingReadSyncRef.current.add(entryId);

    void window.catpaw!.rss.markRead(entryId, true).catch(async (error) => {
      reportError('更新已读状态失败', error);
      await Promise.all([loadFeeds(), loadEntries()]);
    }).finally(() => pendingReadSyncRef.current.delete(entryId));
  }, [loadEntries, loadFeeds, reportError]);

  const refreshEntrySnapshot = useCallback(async (entryId: string) => {
    if (!window.catpaw) return null;
    const refreshed = await window.catpaw.rss.getEntry(entryId);
    if (refreshed) {
      mergeEntrySnapshot(refreshed);
    }
    return refreshed;
  }, [mergeEntrySnapshot]);

  const handleAnalyzeEntry = useCallback(async () => {
    const entryId = selectedEntryId;
    await generateSummary();
    if (entryId && selectedEntryRef.current?.id === entryId) {
      await refreshEntrySnapshot(entryId).catch((error) => reportError('刷新文章失败', error));
    }
  }, [selectedEntryId, generateSummary, refreshEntrySnapshot, reportError]);

  const fetchFullContent = useCallback(async (
    entry: Entry | null | undefined,
    options?: {
      force?: boolean;
      reportErrors?: boolean;
    },
  ) => {
    if (!window.catpaw?.rss.fetchEntryContent || !entry?.id) {
      return { ok: false, error: 'UNAVAILABLE' } as const;
    }
    if (!options?.force && !shouldExtractFullContent(entry)) {
      return { ok: false, skipped: true } as const;
    }
    if (requestedFullContentRef.current.has(entry.id)) {
      return { ok: false, error: 'FETCH_IN_PROGRESS', skipped: true } as const;
    }

    requestedFullContentRef.current.add(entry.id);
    updateEntryPreview(entry.id, {
      contentFetchStatus: 'fetching',
      contentFetchAttemptedAt: Date.now(),
      contentFetchError: null,
    });

    try {
      const result = await window.catpaw.rss.fetchEntryContent(entry.id);
      await refreshEntrySnapshot(entry.id);
      if (!result?.ok && options?.reportErrors && result?.error && result.error !== 'NO_CONTENT') {
        reportError('抓取全文失败', result.error);
      }
      return result;
    } catch (error) {
      await refreshEntrySnapshot(entry.id).catch(() => undefined);
      if (options?.reportErrors) {
        reportError('抓取全文失败', error);
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      requestedFullContentRef.current.delete(entry.id);
    }
  }, [refreshEntrySnapshot, reportError, shouldExtractFullContent, updateEntryPreview]);

  const shouldResolveXiaoyuzhouAudio = useCallback((entry: Entry | null | undefined) => {
    if (!entry?.link) return false;
    if (entry.mediaType && entry.mediaUrl) return false;
    try {
      const parsed = new URL(entry.link);
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      return host.includes('xiaoyuzhoufm.com') && parsed.pathname.toLowerCase().includes('/episode/');
    } catch {
      return false;
    }
  }, []);

  const loadEntryDetail = useCallback(async (entryId: string | null) => {
    const current = beginDetailRequest();
    if (!entryId || !window.catpaw) {
      setSelectedEntry(null);
      setSocialThread(null);
      setLoadingSocialThread(false);
      return;
    }
    try {
      const cachedEntry = selectedEntryRef.current?.id === entryId ? selectedEntryRef.current : null;
      const entry = cachedEntry ?? await window.catpaw.rss.getEntry(entryId);
      if (!current()) return;
      setSelectedEntry(entry);

      setSocialThread(null);

      if (entry && resolveEntryTweetId(entry) && typeof window.catpaw?.rss.getSocialThread === 'function') {
        setLoadingSocialThread(true);
        void (async () => {
          try {
            const thread = await window.catpaw!.rss.getSocialThread(entry.id);
            if (!current()) return;
            if (thread?.ok) {
              setSocialThread(thread.items ?? []);
            } else if (thread?.error) {
              reportError('载入讨论串失败', thread.error);
            }
          } catch (error) {
            if (current()) reportError('载入讨论串失败', error);
          } finally {
            if (current()) {
              setLoadingSocialThread(false);
            }
          }
        })();
      } else {
        setLoadingSocialThread(false);
      }

      if (
        entry &&
        shouldResolveXiaoyuzhouAudio(entry) &&
        !requestedXiaoyuzhouAudioRef.current.has(entryId) &&
        typeof window.catpaw?.rss.resolveXiaoyuzhouAudio === 'function'
      ) {
        requestedXiaoyuzhouAudioRef.current.add(entryId);
        void (async () => {
          try {
            const resolved = await window.catpaw!.rss.resolveXiaoyuzhouAudio(entryId);
            if (resolved?.ok && resolved.mediaUrl) {
              await refreshEntrySnapshot(entryId);
            } else if (current() && resolved?.error && resolved.error !== 'NO_XIAOYUZHOU_EPISODE' && resolved.error !== 'NO_AUDIO_URL') {
              reportError('解析小宇宙音频失败', resolved.error);
            }
          } catch (error) {
            if (current()) reportError('解析小宇宙音频失败', error);
          } finally {
            requestedXiaoyuzhouAudioRef.current.delete(entryId);
          }
        })();
      }

      if (entry && shouldExtractFullContent(entry)) {
        void fetchFullContent(entry);
      }

      if (entry && entry.isRead === 0) {
        applyReadStateLocally(entry);
        syncReadStateInBackground(entryId);
      }
    } catch (error) {
      if (current()) reportError('载入文章详情失败', error);
    }
  }, [
    applyReadStateLocally,
    beginDetailRequest,
    fetchFullContent,
    refreshEntrySnapshot,
    reportError,
    shouldExtractFullContent,
    shouldResolveXiaoyuzhouAudio,
    syncReadStateInBackground,
  ]);

  useEffect(() => {
    void loadEntryDetail(selectedEntryId);
  }, [selectedEntryId, loadEntryDetail]);

  useEffect(() => {
    return () => {
      pendingReadSyncRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setFetchingContent(false);
    setVideoStartAt(null);
  }, [selectedEntryId]);

  const handleFetchFullContent = useCallback(async (entryId: string) => {
    if (!window.catpaw || fetchingContent) return;
    const current = beginContentRequest();
    setFetchingContent(true);
    try {
      const targetEntry = selectedEntry?.id === entryId
        ? selectedEntry
        : entriesRef.current.find((item) => item.id === entryId) ?? null;
      const result = await fetchFullContent(targetEntry, { force: true });
      if (current() && !result.ok && 'error' in result && result.error !== 'NO_CONTENT') reportError('抓取全文失败', result.error);
    } catch (error) {
      if (current()) reportError('抓取全文失败', error);
    } finally {
      if (current()) setFetchingContent(false);
    }
  }, [entriesRef, fetchFullContent, fetchingContent, reportError, selectedEntry, beginContentRequest]);

  const handleToggleStar = useCallback(async () => {
    if (!window.catpaw || !selectedEntryId) return;
    try {
      await window.catpaw.rss.toggleStar(selectedEntryId);
      await refreshEntrySnapshot(selectedEntryId);
      await loadFeeds();
      await loadSmartCounts();
    } catch (error) {
      reportError('更新收藏失败', error);
    }
  }, [refreshEntrySnapshot, loadFeeds, loadSmartCounts, reportError, selectedEntryId]);

  const handleJumpToChapter = useCallback((seconds: number) => {
    const player = mediaPlayerRef.current;
    if (player && Number.isFinite(seconds) && seconds >= 0) {
      player.currentTime = seconds;
      void player.play().catch(() => undefined);
      return;
    }
    const fallbackVideo = resolveVideoEmbedFromLink(selectedEntry?.link ?? null);
    if ((selectedEntry?.mediaType === 'video' && selectedEntry?.mediaUrl) || fallbackVideo) {
      setVideoStartAt(seconds);
    }
  }, [selectedEntry]);

  return {
    selectedEntry: selectedEntry?.id === selectedEntryId ? selectedEntry : null,
    fetchingContent,
    analyzingEntry,
    entryAnalysis,
    videoStartAt,
    socialThread,
    loadingSocialThread,
    mediaPlayerRef,
    handleFetchFullContent,
    handleAnalyzeEntry,
    handleCancelAnalysis,
    handleToggleStar,
    handleJumpToChapter,
  };
}
