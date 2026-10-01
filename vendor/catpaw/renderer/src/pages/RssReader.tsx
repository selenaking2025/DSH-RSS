import { useReaderJobs } from '../features/rss-reader/useReaderJobs';
import { useReaderSubscriptions } from '../features/rss-reader/useReaderSubscriptions';
import { useReaderDataChanges } from '../features/rss-reader/useReaderDataChanges';
import { friendlyReaderError } from '../features/rss-reader/errors';
import { ReaderDialogs } from '../features/rss-reader/dialogs/ReaderDialogs';
import type { ReaderDialog } from '../features/rss-reader/dialogs/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createArticleSanitizer, articleSanitizeOptions, resolveArticleLinks } from '../features/rss-reader/article-presentation';
import { ArticleDetail } from '../features/rss-reader/ArticleDetail';
import { ReadingArticles } from '../features/rss-reader/smart-reading/ReadingArticles';
import type { ReadingSettingsTab } from '../features/rss-reader/smart-reading/ReadingSettings';
import {
  ON_MY_MAC_GROUP_RANK,
  SIDEBAR_GROUP_RANK,
  type PrimaryGroupName,
  smartFeeds,
  LAST_ACTIVE_FEED_STORAGE_KEY,
} from '../features/rss-reader/constants';
import { FeedSidebar } from '../features/rss-reader/FeedSidebar';
import { ReaderIcon } from '../features/rss-reader/ReaderIcon';
import type {
  Feed,
  GroupTreeNode,
  MediaChapter,
  SmartFeedId,
} from '../features/rss-reader/types';
import { useEntryDetailState } from '../features/rss-reader/useEntryDetailState';
import { useEntryListState } from '../features/rss-reader/useEntryListState';
import {
  buildVideoEmbed,
  compareLabels,
  extractChaptersFromEntry,
  getEntryContentLength,
  getUrlHostLabel,
  pickInitialFeedId,
  resolveEntryTweetId,
  resolveVideoEmbedFromLink,
  shouldHideGroupActions,
  startOfToday,
} from '../features/rss-reader/utils';
import { useSchedulerStatus } from '../hooks/useSchedulerStatus';
import { useTranslationPreferences } from '../features/rss-reader/translation/useTranslationPreferences';
import { useSummaryPreferences } from '../features/rss-reader/summary/useSummaryPreferences';
import { AppUpdateNotice } from '../features/rss-reader/updates/AppUpdateNotice';

export default function RssReader() {
  const DOMPurify = useMemo(createArticleSanitizer, []);
  const [dialog, setDialog] = useState<ReaderDialog | null>(null);
  const [readingSettingsTab, setReadingSettingsTab] = useState<ReadingSettingsTab | null>(null);
  const { preferences: translationPreferences, savePreferences: saveTranslationPreferences } = useTranslationPreferences();
  const { preferences: summaryPreferences, savePreferences: saveSummaryPreferences } = useSummaryPreferences();
  const [scopeReady, setScopeReady] = useState(false);
  const [activeFeedId, setActiveFeedId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(LAST_ACTIVE_FEED_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [activeSmart, setActiveSmart] = useState<SmartFeedId>('unread');
  const [search, setSearch] = useState('');
  const [compactPane, setCompactPane] = useState<'sources' | 'articles' | 'detail'>('articles');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const markingAllReadRef = useRef(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [wechatLoginRequired, setWechatLoginRequired] = useState(false);

  // Kept apart from the editable field so the sidebar label reflects what is saved,
  // not whatever half-typed value is in the input.
  const [effectiveHistoryStartYear, setEffectiveHistoryStartYear] = useState(2023);

  const initializedDefaultFeedSelectionRef = useRef(false);
  const { schedulerStatus } = useSchedulerStatus({ intervalMs: 2000 });
  const activeSchedulerJob = schedulerStatus?.currentJob ?? null;
  const reportError = useCallback((title: string, error?: unknown) => {
    const detail = error instanceof Error ? error.message : error ? String(error) : '';
    if (detail.includes('WECHAT_LOGIN_REQUIRED')) setWechatLoginRequired(true);
    const friendlyDetail = friendlyReaderError(error);
    setErrorMessage(friendlyDetail ? `${title}：${friendlyDetail}` : title);
  }, []);

  const clearError = useCallback(() => {
    setErrorMessage(null);
    setWechatLoginRequired(false);
  }, []);

  const { groups, feeds, feedsLoaded, unreadCounts, smartCounts, setUnreadCounts, setSmartCounts,
    loadFeedTree, loadUnreadCounts, loadSmartCounts } = useReaderSubscriptions(reportError);

  const handleMarkAllRead = useCallback(async (feedId?: string) => {
    if (markingAllReadRef.current || !window.catpaw) return;
    markingAllReadRef.current = true;
    setMarkingAllRead(true);
    clearError();
    try { await window.catpaw.rss.markAllRead(feedId); }
    catch (error) { reportError('标为已读失败', error); }
    finally { markingAllReadRef.current = false; setMarkingAllRead(false); }
  }, [clearError, reportError]);

  const feedById = useMemo(() => {
    return new Map(feeds.map((feed) => [feed.id, feed]));
  }, [feeds]);

  const groupById = useMemo(() => {
    return new Map(groups.map((group) => [group.id, group]));
  }, [groups]);

  const {
    entries,
    setEntries,
    entriesHasMore,
    loadingMoreEntries,
    loading,
    selectedEntryId,
    setSelectedEntryId,
    entriesRef,
    loadEntries,
    reloadEntries,
    handleLoadMoreEntries,
  } = useEntryListState({
    activeFeedId,
    activeSmart,
    search,
    scopeReady,
    reportError,
  });
  const {
    selectedEntry,
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
  } = useEntryDetailState({
    selectedEntryId,
    summaryModelKey: summaryPreferences.modelKey,
    setEntries,
    entriesRef,
    setUnreadCounts,
    setSmartCounts,
    loadEntries,
    loadFeeds: loadFeedTree,
    loadSmartCounts,
    reportError,
  });

  const { activeRefreshJob, activeBackfillJob, refreshBusy, backfillBusy, refreshStatus, backfillStatus,
    handleCancelActiveJobs, handleRefresh, handleBackfill, startRefresh, startInitialHistorySync } = useReaderJobs({
    activeFeedId, activeSchedulerJob, clearError, reportError, loadFeedTree, loadUnreadCounts, loadSmartCounts, loadEntries: reloadEntries,
  });

  useReaderDataChanges({ entries: reloadEntries, subscriptions: loadFeedTree,
    counts: () => Promise.all([loadUnreadCounts(), loadSmartCounts()]) });

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!addMenuRef.current) return;
      if (!addMenuRef.current.contains(event.target as Node)) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const groupFeedIdsById = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    for (const group of groups) {
      if (!group.parentId) continue;
      if (!childrenByParent.has(group.parentId)) {
        childrenByParent.set(group.parentId, []);
      }
      childrenByParent.get(group.parentId)!.push(group.id);
    }

    const descendantsCache = new Map<string, Set<string>>();
    const collectDescendants = (groupId: string): Set<string> => {
      const cached = descendantsCache.get(groupId);
      if (cached) return cached;
      const ids = new Set<string>([groupId]);
      for (const childId of childrenByParent.get(groupId) ?? []) {
        for (const nestedId of collectDescendants(childId)) {
          ids.add(nestedId);
        }
      }
      descendantsCache.set(groupId, ids);
      return ids;
    };

    const result = new Map<string, string[]>();
    for (const group of groups) {
      const allowedGroupIds = collectDescendants(group.id);
      const feedIds = feeds
        .filter((feed) => Boolean(feed.groupId && allowedGroupIds.has(feed.groupId)))
        .map((feed) => feed.id);
      result.set(group.id, feedIds);
    }
    return result;
  }, [feeds, groups]);

  const handleRefreshGroup = useCallback(
    async (groupId: string) => {
      const targetGroup = groupById.get(groupId);
      if (targetGroup && shouldHideGroupActions(targetGroup.name)) return;
      const targetIds = groupFeedIdsById.get(groupId) ?? [];
      if (targetIds.length === 0) return;
      await startRefresh(targetIds);
    },
    [groupById, groupFeedIdsById, startRefresh],
  );

  const handleBackfillGroup = useCallback(
    async (groupId: string) => {
      const targetGroup = groupById.get(groupId);
      if (targetGroup && shouldHideGroupActions(targetGroup.name)) return;
      const targetIds = groupFeedIdsById.get(groupId) ?? [];
      if (targetIds.length === 0) return;
      await startInitialHistorySync(targetIds);
    },
    [groupById, groupFeedIdsById, startInitialHistorySync],
  );

  const handleAddSubscription = () => { setAddMenuOpen(false); setDialog({ kind: 'import' }); };

  const handleExportOpml = async () => {
    if (!window.catpaw) return;
    setAddMenuOpen(false);
    clearError();
    try {
      const result = await window.catpaw.rss.exportOpml();
      if (result?.ok === false && result.error && result.error !== 'CANCELLED') {
        reportError('导出失败', result.error);
      }
    } catch (error) {
      reportError('导出失败', error);
    }
  };

  // The backfill button advertises the configured history floor, so it has to be
  // known before the settings dialog is ever opened.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!window.catpaw) return;
      try {
        const settings = await window.catpaw.rss.getRefreshSettings();
        if (!cancelled) setEffectiveHistoryStartYear(settings.historyStartYear);
      } catch {
        // Keep the default label; the settings dialog surfaces real failures.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openRefreshSettings = async () => {
    if (!window.catpaw) return;
    setAddMenuOpen(false);
    try { setDialog({ kind: 'refresh', settings: await window.catpaw.rss.getRefreshSettings() }); }
    catch (error) { reportError('载入刷新设置失败', error); }
  };

  const handleAddFeed = () => { setAddMenuOpen(false); setDialog({ kind: 'add' }); };

  const handleCreateGroup = () => { setAddMenuOpen(false); setDialog({ kind: 'new-folder', parentId: null }); };

  const handleCreateSubgroup = (group: GroupTreeNode) => { setAddMenuOpen(false); setDialog({ kind: 'new-folder', parentId: group.id }); };

  const openSourceHealth = (feedId: string | null = null) => { setAddMenuOpen(false); setDialog({ kind: 'health', feedId }); };

  const openEditFeed = (feed: Feed) => setDialog({ kind: 'edit-feed', feed });

  const handleDeleteFeed = async (feedId?: string | null) => {
    const targetFeedId = feedId ?? activeFeedId;
    if (!window.catpaw || !targetFeedId) return null;
    const target = feedById.get(targetFeedId);
    const label = target?.title ?? target?.url ?? '这个订阅源';
    if (!window.confirm(`确定删除“${label}”吗？该订阅源的全部文章都会被一并删除。`)) return null;
    clearError();
    try {
      const result = await window.catpaw.rss.deleteFeed(targetFeedId);
      if (!result?.ok) {
        reportError('删除订阅源失败', result?.error);
        return result;
      }
      if (activeFeedId === targetFeedId) {
        setActiveFeedId(null);
        setActiveSmart('unread');
        setSelectedEntryId(null);
      }
      if (selectedEntry?.feedId === targetFeedId) {
        setSelectedEntryId((id) => id === selectedEntry.id ? null : id);
      }
      setDialog((current) => {
        if (current !== dialog) return current;
        return current?.kind === 'health' && current.feedId === null ? current : null;
      });

      await Promise.all([loadFeedTree(), loadUnreadCounts()]);
      await loadEntries();
      await loadSmartCounts();
      return result;
    } catch (error) {
      reportError('删除订阅源失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const openEditGroup = (group: GroupTreeNode) => setDialog({ kind: 'edit-group', group });

  const handleDeleteGroup = async (group: GroupTreeNode) => {
    if (!window.catpaw) return;
    const directFeedCount = feeds.filter((feed) => feed.groupId === group.id).length;
    const directChildCount = groups.filter((candidate) => candidate.parentId === group.id).length;
    const parentLabel = group.parentId ? groupById.get(group.parentId)?.name ?? '它的上级文件夹' : '本机订阅';
    if (
      !window.confirm(
        `确定删除文件夹“${group.name}”吗？其中 ${directFeedCount} 个订阅源和 ${directChildCount} 个子文件夹会被移动到「${parentLabel}」；不会删除任何订阅源或文章。`,
      )
    ) {
      return;
    }
    clearError();
    try {
      const result = await window.catpaw.rss.deleteGroup(group.id);
      if (!result.ok) {
        reportError('删除文件夹失败', result.error);
        return;
      }
      await loadFeedTree();
    } catch (error) {
      reportError('删除文件夹失败', error);
    }
  };

  const sortedFeeds = useMemo(() => {
    return [...feeds].sort((a, b) => {
      const aLabel = a.title ?? a.url;
      const bLabel = b.title ?? b.url;
      const order = compareLabels(aLabel, bLabel);
      if (order !== 0) return order;
      return (a.url ?? '').localeCompare(b.url ?? '');
    });
  }, [feeds]);

  useEffect(() => {
    if (!feedsLoaded || initializedDefaultFeedSelectionRef.current) return;
    initializedDefaultFeedSelectionRef.current = true;
    if (sortedFeeds.length === 0) {
      setScopeReady(true);
      return;
    }
    setActiveFeedId((current) => pickInitialFeedId(sortedFeeds, current));
    setScopeReady(true);
  }, [feedsLoaded, sortedFeeds]);

  useEffect(() => {
    if (!activeFeedId) return;
    if (!feeds.some((feed) => feed.id === activeFeedId)) return;
    try {
      window.localStorage.setItem(LAST_ACTIVE_FEED_STORAGE_KEY, activeFeedId);
    } catch {
      // Ignore storage failures.
    }
  }, [activeFeedId, feeds]);

  const groupedFeeds = useMemo(() => {
    const map = new Map<string | null, Feed[]>();
    for (const feed of sortedFeeds) {
      const key = feed.groupId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(feed);
    }
    return map;
  }, [sortedFeeds]);

  const groupTree = useMemo(() => {
    const map = new Map<string, GroupTreeNode>(
      groups.map((group) => [group.id, { ...group, children: [] }]),
    );
    for (const group of groups) {
      if (group.parentId && map.has(group.parentId)) {
        map.get(group.parentId)!.children.push(map.get(group.id)!);
      }
    }
    const roots = Array.from(map.values()).filter((g) => !g.parentId);
    const sortTree = (nodes: GroupTreeNode[]) => {
      nodes.sort((a, b) => {
        if (!a.parentId && !b.parentId) {
          const aRank = SIDEBAR_GROUP_RANK.get(a.name);
          const bRank = SIDEBAR_GROUP_RANK.get(b.name);
          if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
          if (aRank !== undefined) return -1;
          if (bRank !== undefined) return 1;
        }
        return compareLabels(a.name, b.name);
      });
      for (const node of nodes) {
        if (node.children?.length) sortTree(node.children);
      }
    };
    sortTree(roots);
    return roots;
  }, [groups]);

  const primaryGroupIdByName = useMemo(() => {
    const map = new Map<PrimaryGroupName, string>();
    for (const group of groups) {
      if (group.parentId !== null) continue;
      if (!ON_MY_MAC_GROUP_RANK.has(group.name)) continue;
      map.set(group.name as PrimaryGroupName, group.id);
    }
    return map;
  }, [groups]);

  const aiNewsGroupId = primaryGroupIdByName.get('AI资讯') ?? null;

  const groupOptions = useMemo(() => {
    const result: Array<{ id: string | null; label: string }> = [{ id: null, label: '本机订阅' }];
    const walk = (group: GroupTreeNode, depth: number) => {
      result.push({ id: group.id, label: `${'—'.repeat(depth)} ${group.name}`.trim() });
      for (const child of group.children ?? []) walk(child, depth + 1);
    };
    for (const root of groupTree) walk(root, 0);
    return result;
  }, [groupTree]);

  const activeFeed = activeFeedId ? feedById.get(activeFeedId) ?? null : null;
  const activeScopeLabel = useMemo(() => {
    if (activeFeedId) {
      return activeFeed?.title ?? activeFeed?.url ?? '订阅源';
    }
    const smart = smartFeeds.find((item) => item.id === activeSmart);
    return smart?.label ?? '文章';
  }, [activeFeed, activeFeedId, activeSmart]);

  const activeScopeHint = useMemo(() => {
    if (activeFeedId) return null;
    if (activeSmart === 'today') return `${new Date(startOfToday()).toLocaleDateString()} 起`;
    if (activeSmart === 'starred') return '仅显示收藏';
    return '仅显示未读';
  }, [activeFeedId, activeSmart]);

  const hasFeeds = feeds.length > 0;
  const isSearching = search.trim().length > 0;
  const emptyMessage = useMemo(() => {
    if (!hasFeeds) return '还没有订阅源。导入 OPML 或新建一个订阅源开始使用。';
    if (isSearching) return `没有找到与“${search}”匹配的文章。`;
    if (activeFeedId) return '这个订阅源还没有文章。';
    if (activeSmart === 'today') return '今天还没有新文章。';
    if (activeSmart === 'starred') return '还没有收藏的文章。';
    return '暂时都读完了。';
  }, [activeFeedId, activeSmart, hasFeeds, isSearching, search]);

  const sanitizeOptions = articleSanitizeOptions;

  const sanitizedHtml = useMemo(() => {
    if (!selectedEntry?.contentHtml) return null;
    return resolveArticleLinks(DOMPurify.sanitize(selectedEntry.contentHtml, sanitizeOptions), selectedEntry.link);
  }, [selectedEntry, DOMPurify, sanitizeOptions]);

  const resolvedMedia = useMemo(() => {
    const mediaType = selectedEntry?.mediaType ?? null;
    const mediaUrl = selectedEntry?.mediaUrl ?? null;
    if (!selectedEntry) return { mediaType: null as string | null, mediaUrl: null as string | null };
    if (mediaType && mediaUrl) return { mediaType, mediaUrl };
    const fallbackVideo = resolveVideoEmbedFromLink(selectedEntry.link ?? null);
    if (fallbackVideo) {
      return { mediaType: 'video' as const, mediaUrl: fallbackVideo };
    }
    return { mediaType, mediaUrl };
  }, [selectedEntry]);

  const mediaHostLabel = useMemo(() => {
    return getUrlHostLabel(resolvedMedia.mediaUrl ?? selectedEntry?.link ?? null);
  }, [resolvedMedia.mediaUrl, selectedEntry]);

  const mediaChapters = useMemo(() => {
    if (!selectedEntry || !resolvedMedia.mediaType) return [] as MediaChapter[];
    return extractChaptersFromEntry(selectedEntry);
  }, [resolvedMedia.mediaType, selectedEntry]);
  const sanitizedVideoEmbedHtml = useMemo(() => {
    if (resolvedMedia.mediaType !== 'video' || !resolvedMedia.mediaUrl) return null;
    const embedHtml = buildVideoEmbed(resolvedMedia.mediaUrl, videoStartAt);
    if (!embedHtml) return null;
    return DOMPurify.sanitize(embedHtml, sanitizeOptions);
  }, [DOMPurify, resolvedMedia.mediaType, resolvedMedia.mediaUrl, sanitizeOptions, videoStartAt]);
  const selectedTweetId = useMemo(() => resolveEntryTweetId(selectedEntry), [selectedEntry]);
  const selectedFeedLabel = useMemo(() => {
    if (!selectedEntry) return '订阅源';
    const feed = feedById.get(selectedEntry.feedId);
    return feed?.title ?? feed?.url ?? '订阅源';
  }, [feedById, selectedEntry]);
  const hasCapturedContent = useMemo(() => {
    if (!selectedEntry) return false;
    const summary = (selectedEntry.summary ?? '').trim();
    return Boolean((sanitizedHtml && sanitizedHtml.trim()) || summary);
  }, [sanitizedHtml, selectedEntry]);
  const fullContentFetchBusy = fetchingContent || selectedEntry?.contentFetchStatus === 'fetching';
  const hasStoredFullContent = Boolean(
    selectedEntry
    && selectedEntry.contentFetchStatus === 'fetched'
    && getEntryContentLength(selectedEntry) >= 400,
  );
  const fullContentFetchLabel = hasStoredFullContent
    ? '正文已缓存'
    : fullContentFetchBusy
      ? '正在抓取…'
      : selectedEntry?.contentFetchStatus === 'failed'
        ? '重试抓取正文'
        : '抓取全文';
  const fullContentFetchHint = useMemo(() => {
    switch (selectedEntry?.contentFetchStatus) {
      case 'fetching':
        return '正在后台抓取全文。';
      case 'fetched':
        return hasStoredFullContent ? '全文已缓存在本地。' : null;
      case 'no_content':
        return '这个来源没有提供更多正文内容。';
      case 'auth_required':
        return '这个来源需要先在浏览器中登录，才能抓取正文。';
      case 'failed':
        return selectedEntry?.contentFetchError ? `上次抓取失败：${selectedEntry.contentFetchError}` : '上次抓取失败，可以手动重试。';
      default:
        return null;
    }
  }, [hasStoredFullContent, selectedEntry]);

  const dialogChanged = async () => {
    await Promise.all([loadFeedTree(), loadUnreadCounts(), loadSmartCounts(), loadEntries()]);
  };
  return (
    <div className="page page-reader">
      {errorMessage && (
        <div className="reader-banner" role="status">
          <span>{errorMessage}</span>
          <div className="reader-banner-actions">
            {wechatLoginRequired && (
              <button
                type="button"
                onClick={async () => {
                  if (!window.catpaw?.rss.openWeChatLogin) return;
                  await window.catpaw.rss.openWeChatLogin();
                }}
              >
                登录微信
              </button>
            )}
            <button type="button" onClick={clearError}>
              知道了
            </button>
          </div>
        </div>
      )}
      <AppUpdateNotice />
      <nav className="reader-compact-nav" aria-label="阅读视图">
        <button type="button" aria-current={compactPane === 'sources' ? 'page' : undefined}
          onClick={() => setCompactPane('sources')}><ReaderIcon name="sources" />订阅</button>
        <button type="button" aria-current={compactPane === 'articles' ? 'page' : undefined}
          onClick={() => setCompactPane('articles')}><ReaderIcon name="list" />文章</button>
        <button type="button" aria-current={compactPane === 'detail' ? 'page' : undefined}
          onClick={() => setCompactPane('detail')}><ReaderIcon name="book" />阅读</button>
      </nav>
      <div className="reader-layout" data-compact-pane={compactPane}>
        <FeedSidebar
          isLoadingFeeds={!feedsLoaded}
          addMenuOpen={addMenuOpen}
          addMenuRef={addMenuRef}
          onToggleAddMenu={() => setAddMenuOpen((prev) => !prev)}
          onAddSubscription={handleAddSubscription}
          onAddFeed={handleAddFeed}
          onCreateGroup={handleCreateGroup}
          onExportOpml={() => {
            void handleExportOpml();
          }}
          onOpenMaintenance={() => { setAddMenuOpen(false); setDialog({ kind: 'maintenance' }); }}
          onOpenApiKeys={() => { setAddMenuOpen(false); setDialog({ kind: 'api-keys' }); }}
          onOpenTranslationSettings={() => { setAddMenuOpen(false); setDialog({ kind: 'translation' }); }}
          onOpenSummarySettings={() => { setAddMenuOpen(false); setDialog({ kind: 'summary' }); }}
          onOpenReadingSettings={() => { setAddMenuOpen(false); setReadingSettingsTab('selection'); }}
          onOpenSourceHealth={() => openSourceHealth(null)}
          onOpenRefreshSettings={() => {
            void openRefreshSettings();
          }}
          onRefresh={handleRefresh}
          onBackfill={handleBackfill}
          historyStartYear={effectiveHistoryStartYear}
          refreshBusy={refreshBusy}
          backfillBusy={backfillBusy}
          activeFeedId={activeFeedId}
          activeSmart={activeSmart}
          smartFeeds={smartFeeds}
          smartCounts={smartCounts}
          onMarkAllRead={handleMarkAllRead}
          markingAllRead={markingAllRead}
          unreadCounts={unreadCounts}
          groupedFeeds={groupedFeeds}
          groupTree={groupTree}
          groupFeedIdsById={groupFeedIdsById}
          hasFeeds={hasFeeds}
          onSelectFeed={(feedId) => {
            setActiveFeedId(feedId);
            setActiveSmart('unread');
            setCompactPane('articles');
          }}
          onEditFeed={openEditFeed}
          onSelectSmartFeed={(smartFeedId) => {
            setActiveFeedId(null);
            setActiveSmart(smartFeedId);
            setCompactPane('articles');
          }}
          onRefreshGroup={(groupId) => {
            void handleRefreshGroup(groupId);
          }}
          onBackfillGroup={(groupId) => {
            void handleBackfillGroup(groupId);
          }}
          onCreateSubgroup={handleCreateSubgroup}
          onEditGroup={openEditGroup}
          onDeleteGroup={(group) => {
            void handleDeleteGroup(group);
          }}
        />

        <ReadingArticles
          isSelected={!activeFeedId && activeSmart === 'selected'}
          settingsTab={readingSettingsTab}
          onOpenSettings={setReadingSettingsTab}
          onCloseSettings={() => setReadingSettingsTab(null)}
          onShowSelected={() => { setReadingSettingsTab(null); setActiveFeedId(null); setActiveSmart('selected'); setCompactPane('articles'); }}
          groups={groups}
          search={search}
          onSearch={setSearch}
          activeScopeLabel={activeScopeLabel}
          activeScopeHint={activeScopeHint}
          scopeCounts={!activeFeedId && activeSmart === 'today'
            ? { unread: smartCounts.todayUnread, total: smartCounts.today }
            : undefined}
          entries={entries}
          entriesHasMore={entriesHasMore}
          loading={loading}
          loadingMoreEntries={loadingMoreEntries}
          emptyMessage={emptyMessage}
          selectedEntryId={selectedEntryId}
          feedById={feedById}
          activeRefreshJob={activeRefreshJob}
          activeBackfillJob={activeBackfillJob}
          refreshStatus={refreshStatus}
          backfillStatus={backfillStatus}
          canCancelJobs={refreshBusy || backfillBusy}
          onCancelJobs={handleCancelActiveJobs}
          onSelectEntry={(entryId) => { setSelectedEntryId(entryId); setCompactPane('detail'); }}
          onLoadMore={() => {
            void handleLoadMoreEntries();
          }}
        />

        <ArticleDetail
          selectedEntry={selectedEntry}
          selectedFeedLabel={selectedFeedLabel}
          selectedTweetId={selectedTweetId}
          loadingSocialThread={loadingSocialThread}
          socialThread={socialThread}
          resolvedMedia={resolvedMedia}
          mediaHostLabel={mediaHostLabel}
          mediaChapters={mediaChapters}
          mediaPlayerRef={mediaPlayerRef}
          sanitizedHtml={sanitizedHtml}
          sanitizedVideoEmbedHtml={sanitizedVideoEmbedHtml}
          hasCapturedContent={hasCapturedContent}
          fullContentFetchBusy={fullContentFetchBusy}
          hasStoredFullContent={hasStoredFullContent}
          fullContentFetchLabel={fullContentFetchLabel}
          fullContentFetchHint={fullContentFetchHint}
          analyzingEntry={analyzingEntry}
          entryAnalysis={entryAnalysis}
          onToggleStar={handleToggleStar}
          onFetchFullContent={handleFetchFullContent}
          onAnalyzeEntry={() => { clearError(); void handleAnalyzeEntry(); }}
          onCancelAnalysis={handleCancelAnalysis}
          onJumpToChapter={handleJumpToChapter}
          onConfigureTranslation={() => setDialog({ kind: 'api-keys' })}
          translationPreferences={translationPreferences}
        />
      </div>

      <ReaderDialogs dialog={dialog} onClose={() => setDialog(null)} onChanged={dialogChanged}
        translationPreferences={translationPreferences} onSaveTranslationPreferences={saveTranslationPreferences}
        summaryPreferences={summaryPreferences} onSaveSummaryPreferences={saveSummaryPreferences}
        onConfigureApiKeys={() => setDialog({ kind: 'api-keys' })}
        groups={groups} groupOptions={groupOptions} primaryGroupIdByName={primaryGroupIdByName} aiNewsGroupId={aiNewsGroupId}
        feedById={feedById} notify={reportError} onImported={startInitialHistorySync} onRefresh={startRefresh}
        onDelete={handleDeleteFeed} onHealth={openSourceHealth} onHistoryYearChanged={setEffectiveHistoryStartYear} />
    </div>
  );
}
