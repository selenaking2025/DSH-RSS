import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getEntryDisplayTitle, isXPostLink } from '../../../../electron/contracts/article-title';
import type { SchedulerJob } from '../../hooks/rss-types';
import { formatEntryTimestamp } from './utils';
import type { Entry, Feed } from './types';
import { ReaderIcon } from './ReaderIcon';

import type { RunStatus as RefreshStatus } from './run-results';
type BackfillStatus = RefreshStatus;

const SKELETON_ROWS = 6;

export type ArticleListProps = {
  search: string;
  onSearch: (search: string) => void;
  activeScopeLabel: string;
  activeScopeHint: string | null;
  scopeCounts?: { unread: number; total: number };
  entries: Entry[];
  entriesHasMore: boolean;
  loading: boolean;
  loadingMoreEntries: boolean;
  emptyMessage: string;
  selectedEntryId: string | null;
  feedById: Map<string, Feed>;
  activeRefreshJob: SchedulerJob | null;
  activeBackfillJob: SchedulerJob | null;
  refreshStatus: RefreshStatus | null;
  backfillStatus: BackfillStatus | null;
  canCancelJobs: boolean;
  onCancelJobs: () => void;
  onSelectEntry: (entryId: string) => void;
  onLoadMore: () => void;
};

export function ArticleList(props: ArticleListProps) {
  const [searchText, setSearchText] = useState(props.search);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setSearchText(props.search); }, [props.search]);
  useEffect(() => {
    if (searchText === props.search) return;
    const timer = setTimeout(() => props.onSearch(searchText), 200);
    return () => clearTimeout(timer);
  }, [searchText, props.search, props.onSearch]);
  const {
    activeScopeLabel,
    activeScopeHint,
    entries,
    entriesHasMore,
    loading,
    loadingMoreEntries,
    emptyMessage,
    selectedEntryId,
    feedById,
    activeRefreshJob,
    activeBackfillJob,
    refreshStatus,
    backfillStatus,
    canCancelJobs,
    onCancelJobs,
    onSelectEntry,
    onLoadMore,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: entries.length, getScrollElement: () => scrollRef.current,
    // Keep the visible keyed row anchored when new articles are prepended. The
    // virtualizer also reconciles late row measurements without a second scroll.
    anchorTo: 'end', followOnAppend: false,
    getItemKey: (index) => entries[index].id, estimateSize: () => 135, overscan: 6 });
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [activeScopeLabel]);
  useEffect(() => {
    const index = entries.findIndex((entry) => entry.id === selectedEntryId);
    if (index >= 0) virtual.scrollToIndex(index, { align: 'auto' });
  }, [selectedEntryId]);

  // Inside a single-feed scope the source name repeats on every row and tells
  // the reader nothing, so it is only shown when the list actually mixes feeds.
  const showSource = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of entries) {
      seen.add(entry.feedId);
      if (seen.size > 1) return true;
    }
    return false;
  }, [entries]);

  const loadedUnreadCount = useMemo(
    () => entries.reduce((total, entry) => total + (entry.isRead ? 0 : 1), 0),
    [entries],
  );
  const scopeCounts = props.search.trim() ? undefined : props.scopeCounts;
  const unreadCount = scopeCounts?.unread ?? loadedUnreadCount;
  const totalCount = scopeCounts ? `${scopeCounts.total}` : `${entries.length}${entriesHasMore ? '+' : ''}`;

  return (
    <section className="reader-articles" aria-label="文章列表">
      <div className="reader-articles-header">
        <div className="reader-articles-heading">
          <h1 className="reader-articles-title" title={activeScopeLabel}>{activeScopeLabel}</h1>
          {activeScopeHint ? <div className="reader-articles-hint">{activeScopeHint}</div> : null}
        </div>
        <div className="reader-articles-count">
          {props.scopeCounts || unreadCount > 0
            ? `${unreadCount} 未读 / ${totalCount}`
            : `${totalCount} 篇`}
        </div>
      </div>
      <div className="reader-search">
        <ReaderIcon name="search" className="reader-search-icon" />
        <input ref={searchRef} type="search" aria-label="搜索当前范围的文章" placeholder="搜索文章…"
          value={searchText} onChange={(event) => setSearchText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') setSearchText(''); }} />
        {searchText && (
          <button type="button" className="reader-search-clear" aria-label="清除搜索"
            onClick={() => { setSearchText(''); props.onSearch(''); searchRef.current?.focus(); }}>
            <ReaderIcon name="close" />
          </button>
        )}
      </div>
      {(activeBackfillJob || backfillStatus) && (
        <div className="reader-progress" role="status">
          {activeBackfillJob
            ? `正在回补历史（${activeBackfillJob.feedsCompleted}/${activeBackfillJob.totalFeeds}，已扫描 ${activeBackfillJob.newEntries} 条新条目）…`
            : backfillStatus?.phase === 'running' && activeRefreshJob
              ? '历史回补正在等待刷新完成…'
            : (backfillStatus?.phase === 'running' || backfillStatus?.phase === 'stopping')
              ? `正在回补历史（${backfillStatus.done}/${backfillStatus.total}）…`
              : backfillStatus?.phase === 'cancelled'
                // A stopped run is not a finished one, however much it managed to fetch.
                ? `已停止回补，已抓取的 ${backfillStatus.scannedItems} 条已保留。`
                : backfillStatus && backfillStatus.phase === 'failed'
                ? `回补未完成（${backfillStatus.done}/${backfillStatus.total}，已扫描 ${backfillStatus.scannedItems} 条）。`
                : `回补完成（${backfillStatus?.done ?? 0}/${backfillStatus?.total ?? 0}，已扫描 ${backfillStatus?.scannedItems ?? 0} 条）。${
                    backfillStatus?.historyIncapable
                      ? `其中 ${backfillStatus.historyIncapable} 个源不支持历史分页，只取到了最新一页。`
                      : ''
                  }`}
          {canCancelJobs && (
            <button type="button" className="reader-progress-cancel" onClick={onCancelJobs}>
              停止
            </button>
          )}
        </div>
      )}
      {(activeRefreshJob || refreshStatus) && (
        <div className="reader-progress" role="status">
          {activeRefreshJob
            ? `正在刷新 ${activeRefreshJob.feedsCompleted}/${activeRefreshJob.totalFeeds} 个订阅源（新增 ${activeRefreshJob.newEntries} 条）…`
            : (refreshStatus?.phase === 'running' || refreshStatus?.phase === 'stopping')
              ? `正在刷新 ${refreshStatus.done}/${refreshStatus.total} 个订阅源…`
              : refreshStatus?.phase === 'cancelled'
                ? `已停止刷新（${refreshStatus.done}/${refreshStatus.total}），已获取的文章已保留。`
                : refreshStatus && refreshStatus.phase === 'failed'
                  ? `刷新未完成（${refreshStatus.done}/${refreshStatus.total}）。`
                  : `刷新完成（共 ${refreshStatus?.total ?? 0} 个订阅源）。`}
        </div>
      )}
      <div className="reader-article-list" ref={scrollRef} aria-busy={loading} style={{ overflowAnchor: 'none' }}>
        <div style={{ height: virtual.getTotalSize(), position: 'relative', flexShrink: 0 }}>
        {virtual.getVirtualItems().map((row) => {
          const article = entries[row.index];
          const feed = feedById.get(article.feedId);
          const selected = selectedEntryId === article.id;
          const displayTitle = getEntryDisplayTitle(article);
          return (
            <button
              key={article.id}
              ref={virtual.measureElement}
              data-index={row.index}
              data-entry-id={article.id}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }}
              type="button"
              aria-current={selected ? 'true' : undefined}
              className={`article-card${article.isRead ? '' : ' unread'}${selected ? ' selected' : ''}`}
              onClick={() => onSelectEntry(article.id)}
            >
              <div className="article-meta">
                {article.isStarred === 1 && <ReaderIcon name="starred" className="article-star" aria-label="已收藏" aria-hidden={false} role="img" />}
                {showSource && (
                  <span className="article-source">
                    {feed?.title ?? feed?.url ?? '订阅源'}
                  </span>
                )}
                <span className="article-time">{formatEntryTimestamp(article.publishedAt)}</span>
              </div>
              <div className={`article-title${isXPostLink(article.link) ? ' article-title-x' : ''}`} title={displayTitle}>{displayTitle}</div>
              {article.summary && <div className="article-summary">{article.summary}</div>}
            </button>
          );
        })}
        </div>
        {entries.length === 0 && loading && (
          <div className="article-skeleton-list" aria-label="正在载入文章" role="status">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <div key={`article-skeleton-${index}`} className="article-skeleton" aria-hidden="true">
                <span className="article-skeleton-line meta" />
                <span className="article-skeleton-line title" />
                <span className="article-skeleton-line title short" />
                <span className="article-skeleton-line summary" />
              </div>
            ))}
          </div>
        )}
        {entries.length === 0 && !loading && (
          <div className="empty-state" role="status">
            <ReaderIcon name={searchText ? 'search' : 'unread'} />
            <p>{emptyMessage}</p>
          </div>
        )}
        {entries.length > 0 && entriesHasMore && (
          <button
            type="button"
            className="reader-load-more"
            onClick={onLoadMore}
            disabled={loadingMoreEntries}
          >
            {loadingMoreEntries ? '正在载入…' : '载入更多'}
          </button>
        )}
      </div>
    </section>
  );
}
