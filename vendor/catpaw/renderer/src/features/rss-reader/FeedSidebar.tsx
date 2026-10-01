import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { getFallbackColor, getFeedIconUrl, getInitial, shouldHideGroupActions } from './utils';
import type { Feed, GroupTreeNode, SmartCounts, SmartFeedId } from './types';
import { ReaderIcon } from './ReaderIcon';
import { FeedGroupMenu } from './FeedGroupMenu';
import { FeedReadMenu, isReadMenuKey, type FeedReadMenuTarget, type ReadMenuEvent } from './FeedReadMenu';
import { useSidebarGroupFilter } from './useSidebarGroupFilter';
import { AppearanceToggle } from './AppearanceToggle';
import { AppUpdateButton } from './updates/AppUpdateButton';

const SIDEBAR_VIRTUALIZATION_THRESHOLD = 80;
const FEED_ROW_HEIGHT = 38;
const GROUP_ROW_HEIGHT = 34;
const VIRTUAL_OVERSCAN_PX = 320;

type FeedSidebarProps = {
  isLoadingFeeds: boolean;
  addMenuOpen: boolean;
  addMenuRef: RefObject<HTMLDivElement>;
  onToggleAddMenu: () => void;
  onAddSubscription: () => void;
  onAddFeed: () => void;
  onCreateGroup: () => void;
  onExportOpml: () => void;
  onOpenSourceHealth: () => void;
  onOpenRefreshSettings: () => void;
  onOpenMaintenance: () => void;
  onOpenApiKeys: () => void;
  onOpenTranslationSettings: () => void;
  onOpenSummarySettings: () => void;
  onOpenReadingSettings: () => void;
  onRefresh: () => void;
  onBackfill: () => void;
  historyStartYear: number;
  refreshBusy: boolean;
  backfillBusy: boolean;
  activeFeedId: string | null;
  activeSmart: SmartFeedId;
  smartFeeds: Array<{ id: SmartFeedId; label: string }>;
  smartCounts: SmartCounts;
  onMarkAllRead: (feedId?: string) => Promise<void>;
  markingAllRead: boolean;
  unreadCounts: Record<string, number>;
  groupedFeeds: Map<string | null, Feed[]>;
  groupTree: GroupTreeNode[];
  groupFeedIdsById: Map<string, string[]>;
  hasFeeds: boolean;
  onSelectFeed: (feedId: string) => void;
  onEditFeed: (feed: Feed) => void;
  onSelectSmartFeed: (smartFeedId: SmartFeedId) => void;
  onRefreshGroup: (groupId: string) => void;
  onBackfillGroup: (groupId: string) => void;
  onCreateSubgroup: (group: GroupTreeNode) => void;
  onEditGroup: (group: GroupTreeNode) => void;
  onDeleteGroup: (group: GroupTreeNode) => void;
};

type FeedButtonProps = {
  feed: Feed;
  active: boolean;
  unreadCount: number;
  onClick: () => void;
  onEdit: () => void;
  onReadMenu: (event: ReadMenuEvent, feed: Feed | null) => void;
};

type VirtualGroupRow = {
  kind: 'group';
  key: string;
  group: GroupTreeNode;
  depth: number;
  top: number;
  bottom: number;
};

type VirtualFeedRow = {
  kind: 'feed';
  key: string;
  feed: Feed;
  depth: number;
  top: number;
  bottom: number;
};

type VirtualSidebarRow = VirtualGroupRow | VirtualFeedRow;

const FeedButton = memo(function FeedButton(props: FeedButtonProps) {
  const { feed, active, unreadCount, onClick, onEdit, onReadMenu } = props;
  const label = feed.title ?? feed.url;
  const iconUrl = getFeedIconUrl(feed);
  const fallbackColor = getFallbackColor(label);
  return (
    <div className={`reader-item reader-feed-item${active ? ' active' : ''}${feed.enabled === 0 ? ' paused' : ''}`}
      onContextMenu={(event) => onReadMenu(event, feed)}
      onKeyDown={(event) => { if (isReadMenuKey(event)) onReadMenu(event, feed); }}>
      <button
        type="button"
        className="reader-item-select"
        aria-haspopup="menu"
        aria-current={active ? 'true' : undefined}
        aria-description={feed.enabled === 0 ? '已暂停定时刷新' : undefined}
        title={feed.enabled === 0 ? `${label}（已暂停定时刷新）` : label}
        onClick={onClick}
      >
        <span className="reader-item-main">
          <span className="reader-icon" style={{ backgroundColor: fallbackColor }} aria-hidden="true">
            <span className="reader-icon-letter">{getInitial(label)}</span>
            {iconUrl && (
              <img
                src={iconUrl}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            )}
          </span>
          <span className="reader-item-text">{label}</span>
        </span>
      </button>
      <span className="reader-item-side">
        <span className={`reader-count${unreadCount === 0 ? ' is-zero' : ''}`}>{unreadCount}</span>
        <button
          type="button"
          className="reader-feed-action"
          onClick={onEdit}
          aria-label={`编辑 ${label}`}
          title={`编辑 ${label}`}
        >
          <ReaderIcon name="more" />
        </button>
      </span>
    </div>
  );
});

function buildVirtualRows(args: {
  feeds: Feed[];
  groupedFeeds: Map<string | null, Feed[]>;
  groupTree: GroupTreeNode[];
}): VirtualSidebarRow[] {
  const { feeds, groupedFeeds, groupTree } = args;
  const rows: VirtualSidebarRow[] = [];
  let offset = 0;

  const pushFeed = (feed: Feed, depth = 0) => {
    rows.push({
      kind: 'feed',
      key: `feed-${feed.id}`,
      feed,
      depth,
      top: offset,
      bottom: offset + FEED_ROW_HEIGHT,
    });
    offset += FEED_ROW_HEIGHT;
  };

  const walkGroups = (groups: GroupTreeNode[], depth: number) => {
    for (const group of groups) {
      rows.push({
        kind: 'group',
        key: `group-${group.id}`,
        group,
        depth,
        top: offset,
        bottom: offset + GROUP_ROW_HEIGHT,
      });
      offset += GROUP_ROW_HEIGHT;

      for (const feed of groupedFeeds.get(group.id) ?? []) {
        pushFeed(feed, depth);
      }
      walkGroups(group.children, depth + 1);
    }
  };

  for (const feed of feeds) {
    pushFeed(feed);
  }

  walkGroups(groupTree, 0);

  return rows;
}

export function FeedSidebar(props: FeedSidebarProps) {
  const {
    isLoadingFeeds,
    addMenuOpen,
    addMenuRef,
    onToggleAddMenu,
    onAddSubscription,
    onAddFeed,
    onCreateGroup,
    onExportOpml,
    onOpenSourceHealth,
    onOpenRefreshSettings,
    onOpenMaintenance,
    onOpenApiKeys,
    onOpenTranslationSettings,
    onOpenSummarySettings,
    onOpenReadingSettings,
    onRefresh,
    onBackfill,
    historyStartYear,
    refreshBusy,
    backfillBusy,
    activeFeedId,
    activeSmart,
    smartFeeds,
    smartCounts,
    unreadCounts,
    groupedFeeds,
    groupTree,
    groupFeedIdsById,
    hasFeeds,
    onSelectFeed,
    onEditFeed,
    onSelectSmartFeed,
    onRefreshGroup,
    onBackfillGroup,
    onCreateSubgroup,
    onEditGroup,
    onDeleteGroup,
  } = props;

  const [readMenu, setReadMenu] = useState<FeedReadMenuTarget | null>(null);
  const closeReadMenu = useCallback(() => setReadMenu(null), []);
  const openReadMenu = useCallback((event: ReadMenuEvent, feed: Feed | null) => {
    event.preventDefault();
    event.stopPropagation();
    const trigger = event.currentTarget instanceof HTMLButtonElement
      ? event.currentTarget : event.currentTarget.querySelector<HTMLButtonElement>('.reader-item-select');
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    const usePointer = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0);
    setReadMenu({
      feedId: feed?.id ?? null,
      label: feed ? feed.title ?? feed.url : '全部未读',
      trigger,
      x: usePointer ? event.clientX : bounds.left + 12,
      y: usePointer ? event.clientY : bounds.bottom,
    });
    if (addMenuOpen) onToggleAddMenu();
  }, [addMenuOpen, onToggleAddMenu]);

  const backfillLabel = activeFeedId
    ? `从 ${historyStartYear} 年起回补当前订阅源`
    : `从 ${historyStartYear} 年起回补全部订阅源`;

  const unreadCountDigits = useMemo(
    () => Object.values(unreadCounts).reduce((digits, count) => Math.max(digits, String(count).length), 3),
    [unreadCounts],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!addMenuOpen) return;
    const placeMenu = () => {
      const anchor = addMenuRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      setMenuPosition({
        top: Math.max(8, Math.min(anchor.bottom + 8, window.innerHeight - menu.offsetHeight - 8)),
        left: Math.max(8, Math.min(anchor.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)),
      });
    };
    placeMenu();
    menuRef.current?.querySelector('button')?.focus();
    window.addEventListener('resize', placeMenu);
    return () => window.removeEventListener('resize', placeMenu);
  }, [addMenuOpen, addMenuRef]);
  const virtualSectionRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({
    scrollTop: 0,
    height: 0,
    sectionTop: 0,
  });
  const shouldShowEmptyState = !isLoadingFeeds && !hasFeeds;
  const { groupOptions, selectedGroup, selectedGroupId, visibleGroupTree, visibleFeeds, selectGroup } = useSidebarGroupFilter(groupTree, groupedFeeds, isLoadingFeeds);
  const isSelectedGroupEmpty = !isLoadingFeeds && selectedGroupId !== ''
    && visibleFeeds.length === 0;

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [selectedGroupId]);

  const virtualRows = useMemo(
    () =>
      isLoadingFeeds
        ? []
        : buildVirtualRows({
            feeds: visibleFeeds,
            groupedFeeds,
            groupTree: visibleGroupTree,
          }),
    [visibleGroupTree, visibleFeeds, groupedFeeds, isLoadingFeeds],
  );

  const shouldVirtualize = virtualRows.length > SIDEBAR_VIRTUALIZATION_THRESHOLD;
  const totalVirtualHeight = virtualRows.length > 0 ? virtualRows[virtualRows.length - 1].bottom : 0;

  const renderGroupActions = (group: GroupTreeNode, hasGroupFeeds: boolean, showManagement: boolean) => (
    <div className="reader-group-actions">
      {showManagement && hasGroupFeeds && (
        <>
          <button
            type="button"
            className="reader-group-action"
            onClick={() => onRefreshGroup(group.id)}
            aria-label={`刷新 ${group.name}`}
            title={`刷新 ${group.name}`}
            disabled={!hasGroupFeeds || refreshBusy}
          >
            <ReaderIcon name="refresh" />
          </button>
          <button
            type="button"
            className="reader-group-action"
            onClick={() => onBackfillGroup(group.id)}
            aria-label={`回补 ${group.name}`}
            title={`从 ${historyStartYear} 年起回补 ${group.name}`}
            disabled={!hasGroupFeeds || refreshBusy || backfillBusy}
          >
            <ReaderIcon name="history" />
          </button>
        </>
      )}
      <button
        type="button"
        className="reader-group-action"
        onClick={() => onCreateSubgroup(group)}
        aria-label={`在 ${group.name} 下新建子文件夹`}
        title={`在 ${group.name} 下新建子文件夹`}
      >
        <ReaderIcon name="plus" />
      </button>
      {showManagement && (
        <>
          <button
            type="button"
            className="reader-group-action"
            onClick={() => onEditGroup(group)}
            aria-label={`编辑 ${group.name}`}
            title={`编辑 ${group.name}`}
          >
            <ReaderIcon name="edit" />
          </button>
          <button
            type="button"
            className="reader-group-action danger"
            onClick={() => onDeleteGroup(group)}
            aria-label={`删除 ${group.name}`}
            title={`删除 ${group.name}`}
          >
            <ReaderIcon name="close" />
          </button>
        </>
      )}
    </div>
  );

  const renderGroupHeader = (group: GroupTreeNode, depth: number) => (
    <div className="reader-group-header" style={{ paddingLeft: `${8 + depth * 12}px` }}>
      <h2 className="reader-group-title" title={group.name}>{group.name}</h2>
      {renderGroupActions(group, (groupFeedIdsById.get(group.id)?.length ?? 0) > 0, !shouldHideGroupActions(group.name))}
    </div>
  );

  const renderGroup = (group: GroupTreeNode, depth = 0): JSX.Element => {
    const groupFeeds = groupedFeeds.get(group.id) ?? [];
    return (
      <div key={group.id} className="reader-group">
        {renderGroupHeader(group, depth)}
        {groupFeeds.length > 0 && (
          <div className="reader-list" style={{ paddingLeft: `${depth * 12}px` }}>
            {groupFeeds.map((feed) => (
              <FeedButton
                key={feed.id}
                feed={feed}
                active={activeFeedId === feed.id}
                unreadCount={unreadCounts[feed.id] ?? 0}
                onClick={() => onSelectFeed(feed.id)}
                onEdit={() => onEditFeed(feed)}
                onReadMenu={openReadMenu}
              />
            ))}
          </div>
        )}
        {group.children.map((child) => renderGroup(child, depth + 1))}
      </div>
    );
  };

  useLayoutEffect(() => {
    if (!shouldVirtualize) {
      return;
    }

    const scrollNode = scrollRef.current;
    if (!scrollNode) {
      return;
    }

    let frameId = 0;

    const updateViewport = () => {
      frameId = 0;
      const sectionNode = virtualSectionRef.current;
      const nextSectionTop = sectionNode
        ? sectionNode.getBoundingClientRect().top
          - scrollNode.getBoundingClientRect().top
          + scrollNode.scrollTop
        : 0;

      setViewport((previous) => {
        const next = {
          scrollTop: scrollNode.scrollTop,
          height: scrollNode.clientHeight,
          sectionTop: nextSectionTop,
        };
        if (
          previous.scrollTop === next.scrollTop
          && previous.height === next.height
          && previous.sectionTop === next.sectionTop
        ) {
          return previous;
        }
        return next;
      });
    };

    const queueViewportUpdate = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(updateViewport);
    };

    updateViewport();
    scrollNode.addEventListener('scroll', queueViewportUpdate, { passive: true });
    window.addEventListener('resize', queueViewportUpdate);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(queueViewportUpdate)
      : null;
    resizeObserver?.observe(scrollNode);
    if (virtualSectionRef.current) {
      resizeObserver?.observe(virtualSectionRef.current);
    }

    return () => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
      scrollNode.removeEventListener('scroll', queueViewportUpdate);
      window.removeEventListener('resize', queueViewportUpdate);
      resizeObserver?.disconnect();
    };
  }, [shouldVirtualize, totalVirtualHeight, selectedGroupId]);

  const visibleVirtualRows = useMemo(() => {
    if (!shouldVirtualize || virtualRows.length === 0) {
      return virtualRows;
    }

    const startY = Math.max(0, viewport.scrollTop - viewport.sectionTop - VIRTUAL_OVERSCAN_PX);
    const endY = Math.max(
      startY + VIRTUAL_OVERSCAN_PX,
      viewport.scrollTop - viewport.sectionTop + viewport.height + VIRTUAL_OVERSCAN_PX,
    );

    let startIndex = 0;
    while (startIndex < virtualRows.length && virtualRows[startIndex].bottom <= startY) {
      startIndex += 1;
    }

    let endIndex = startIndex;
    while (endIndex < virtualRows.length && virtualRows[endIndex].top < endY) {
      endIndex += 1;
    }

    return virtualRows.slice(startIndex, Math.max(startIndex + 1, endIndex));
  }, [shouldVirtualize, viewport.height, viewport.scrollTop, viewport.sectionTop, virtualRows]);

  return (
    <aside className="reader-sources" aria-label="订阅导航"
      style={{ '--reader-unread-width': `${unreadCountDigits * 7.5}px` } as CSSProperties}>
      <div className="reader-topbar">
        <div>
          <div className="reader-brand" aria-label="Catpaw RSS Reader">Catpaw</div>
          <div className="reader-brand-caption">RSS 阅读器</div>
        </div>
        <div className="reader-topbar-actions">
          <div className="menu-anchor" ref={addMenuRef}>
            <button
              type="button"
              className="icon-button"
              onClick={onToggleAddMenu}
              aria-label="添加"
              title="添加"
              aria-expanded={addMenuOpen}
            >
              <ReaderIcon name="plus" />
            </button>
            {addMenuOpen && (
              <div className="menu-panel" ref={menuRef} style={menuPosition} aria-label="添加与设置"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    onToggleAddMenu();
                    addMenuRef.current?.querySelector('button')?.focus();
                  }
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
                  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
                }}>
                <button type="button" className="menu-item" onClick={onAddSubscription}>
                  导入订阅（OPML）
                </button>
                <button type="button" className="menu-item" onClick={onAddFeed}>
                  新建订阅源
                </button>
                <button type="button" className="menu-item" onClick={onCreateGroup}>
                  新建文件夹
                </button>
                <button type="button" className="menu-item" onClick={onExportOpml}>
                  导出 OPML
                </button>
                <div className="menu-separator" role="separator" />
                <button type="button" className="menu-item" onClick={onOpenSourceHealth}>
                  订阅源健康
                </button>
                <button type="button" className="menu-item" onClick={onOpenMaintenance}>应用与数据</button>
                <button type="button" className="menu-item" onClick={onOpenRefreshSettings}>
                  刷新设置
                </button>
                <button type="button" className="menu-item" onClick={onOpenApiKeys}>API Key</button>
                <button type="button" className="menu-item" onClick={onOpenTranslationSettings}>翻译设置</button>
                <button type="button" className="menu-item" onClick={onOpenSummarySettings}>摘要设置</button>
                <button type="button" className="menu-item" onClick={onOpenReadingSettings}>精选设置</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div ref={scrollRef} className="reader-sources-scroll">
        <div className="reader-section">
          {isLoadingFeeds ? (
            <div className="reader-list reader-list-skeleton" aria-hidden="true">
              {Array.from({ length: smartFeeds.length }, (_, index) => (
                <div key={`smart-skeleton-${index}`} className="reader-item-skeleton">
                  <span className="reader-item-main">
                    <span className="reader-icon-skeleton" />
                    <span className="reader-item-text-skeleton" />
                  </span>
                  <span className="reader-count-skeleton" />
                </div>
              ))}
            </div>
          ) : (
            <div className="reader-list">
              {smartFeeds.map((feed) => (
                <button
                  key={feed.id}
                  type="button"
                  className={`reader-item${activeFeedId === null && activeSmart === feed.id ? ' active' : ''}`}
                  aria-current={activeFeedId === null && activeSmart === feed.id ? 'true' : undefined}
                  onClick={() => onSelectSmartFeed(feed.id)}
                  aria-haspopup={feed.id === 'unread' ? 'menu' : undefined}
                  onContextMenu={feed.id === 'unread' ? (event) => openReadMenu(event, null) : undefined}
                  onKeyDown={feed.id === 'unread' ? (event) => { if (isReadMenuKey(event)) openReadMenu(event, null); } : undefined}
                >
                  <span className="reader-item-main">
                    <span className={`reader-icon smart ${feed.id}`} aria-hidden="true">
                      <ReaderIcon name={feed.id} />
                    </span>
                    <span className="reader-item-text">{feed.label}</span>
                  </span>
                  {feed.id !== 'selected' ? <span className="reader-count" title={feed.id === 'today' ? `今天共 ${smartCounts.today} 篇` : undefined}>
                    {smartCounts[feed.id]}
                  </span> : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="reader-section">
          <div className="reader-subscription-filter">
            <div className="reader-subscription-select">
              <select
                aria-label="筛选订阅分组"
                value={selectedGroupId}
                onChange={(event) => selectGroup(event.currentTarget.value)}
                disabled={isLoadingFeeds}
              >
                <option value="">全部订阅</option>
                {groupOptions.map(({ group, label }) => (
                  <option key={group.id} value={group.id}>{label}</option>
                ))}
              </select>
              <ReaderIcon name="chevron" />
            </div>
            {selectedGroup && !isLoadingFeeds && (
              <FeedGroupMenu
                key={selectedGroup.id}
                groupName={selectedGroup.name}
                actions={[
                  ...(!shouldHideGroupActions(selectedGroup.name) && !isSelectedGroupEmpty ? [
                    { label: '刷新分组', onSelect: () => onRefreshGroup(selectedGroup.id), disabled: refreshBusy },
                    { label: '回补历史', onSelect: () => onBackfillGroup(selectedGroup.id), disabled: refreshBusy || backfillBusy },
                  ] : []),
                  { label: '新建子文件夹', onSelect: () => onCreateSubgroup(selectedGroup) },
                  ...(!shouldHideGroupActions(selectedGroup.name) ? [
                    { label: '编辑分组', onSelect: () => onEditGroup(selectedGroup) },
                    { label: '删除分组', onSelect: () => onDeleteGroup(selectedGroup), danger: true },
                  ] : []),
                ]}
              />
            )}
          </div>
          {isLoadingFeeds ? (
            <div className="reader-list reader-list-skeleton" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={`feed-skeleton-${index}`} className="reader-item-skeleton">
                  <span className="reader-item-main">
                    <span className="reader-icon-skeleton" />
                    <span className="reader-item-text-skeleton wide" />
                  </span>
                  <span className="reader-count-skeleton" />
                </div>
              ))}
            </div>
          ) : shouldVirtualize ? (
            <div
              ref={virtualSectionRef}
              className="reader-sidebar-virtual-list"
              style={{ height: `${totalVirtualHeight}px` }}
            >
              {visibleVirtualRows.map((row) => (
                row.kind === 'feed' ? (
                  <div
                    key={row.key}
                    className="reader-sidebar-row reader-sidebar-row-feed"
                    style={{ transform: `translateY(${row.top}px)`, paddingLeft: `${row.depth * 12}px` }}
                  >
                    <FeedButton
                      feed={row.feed}
                      active={activeFeedId === row.feed.id}
                      unreadCount={unreadCounts[row.feed.id] ?? 0}
                      onClick={() => onSelectFeed(row.feed.id)}
                      onEdit={() => onEditFeed(row.feed)}
                      onReadMenu={openReadMenu}
                    />
                  </div>
                ) : (
                  <div
                    key={row.key}
                    className="reader-sidebar-row reader-sidebar-row-group"
                    style={{ transform: `translateY(${row.top}px)` }}
                  >
                    {renderGroupHeader(row.group, row.depth)}
                  </div>
                )
              ))}
            </div>
          ) : (
            <>
              {visibleFeeds.length > 0 && (
                <div className="reader-list">
                  {visibleFeeds.map((feed) => (
                    <FeedButton
                      key={feed.id}
                      feed={feed}
                      active={activeFeedId === feed.id}
                      unreadCount={unreadCounts[feed.id] ?? 0}
                      onClick={() => onSelectFeed(feed.id)}
                      onEdit={() => onEditFeed(feed)}
                      onReadMenu={openReadMenu}
                    />
                  ))}
                </div>
              )}
              {visibleGroupTree.map((group) => renderGroup(group))}
            </>
          )}
          {isSelectedGroupEmpty && hasFeeds && (
            <p className="reader-subscription-empty" role="status">这个分组还没有订阅源。</p>
          )}
        </div>

        {shouldShowEmptyState && (
          <div className="reader-empty-card">
            <div className="reader-empty-title">还没有订阅源</div>
            <div className="reader-empty-subtitle">添加一个订阅源，或导入已有的 OPML 文件。</div>
            <div className="reader-empty-actions">
              <button type="button" onClick={onAddFeed}>
                新建订阅源
              </button>
              <button type="button" onClick={onAddSubscription}>
                导入 OPML
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="reader-sidebar-footer">
        <button type="button" className="icon-button" onClick={onRefresh}
          aria-label="刷新全部订阅源" title={refreshBusy ? '正在刷新订阅…' : '刷新订阅'} disabled={refreshBusy}>
          <ReaderIcon name="refresh" className={refreshBusy ? 'is-spinning' : undefined} />
        </button>
        <button type="button" className="icon-button" onClick={onBackfill}
          aria-label={backfillLabel} title={backfillBusy ? '正在回补历史文章…' : backfillLabel} disabled={refreshBusy || backfillBusy}>
          <ReaderIcon name="history" className={backfillBusy ? 'is-spinning' : undefined} />
        </button>
        <AppUpdateButton />
        <AppearanceToggle />
      </div>
      {readMenu && (
        <FeedReadMenu target={readMenu} onClose={closeReadMenu} onMarkRead={props.onMarkAllRead}
          disabled={props.markingAllRead || (readMenu.feedId === null ? smartCounts.unread : unreadCounts[readMenu.feedId] ?? 0) === 0} />
      )}
    </aside>
  );
}
