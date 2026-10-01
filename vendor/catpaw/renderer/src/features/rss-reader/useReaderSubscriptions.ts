import { useCallback, useEffect, useState } from 'react';
import type { Feed, FeedGroup, SmartCounts } from './types';
import { startOfToday } from './utils';
import { useRequestScope } from './useRequestScope';

export function useReaderSubscriptions(reportError: (title: string, error?: unknown) => void) {
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedsLoaded, setFeedsLoaded] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [smartCounts, setSmartCounts] = useState<SmartCounts>({
    today: 0,
    todayUnread: 0,
    unread: 0,
    starred: 0,
  });
  const treeRequest = useRequestScope('tree');
  const unreadRequest = useRequestScope('unread');
  const smartRequest = useRequestScope('smart');
  const loadFeedTree = useCallback(async () => {
    const current = treeRequest();
    try {
      const rss = window.catpaw?.rss;
      const [data, groupData] = await Promise.all([
        rss?.listFeeds(),
        rss?.listGroups(),
      ]);
      if (!current()) return;
      if (data) setFeeds(data);
      if (groupData) setGroups(groupData);
    } catch (error) {
      if (current()) reportError('载入订阅源失败', error);
    } finally {
      if (current()) setFeedsLoaded(true);
    }
  }, [reportError, treeRequest]);

  const loadUnreadCounts = useCallback(async () => {
    const current = unreadRequest();
    try {
      const unread = await window.catpaw?.rss.getUnreadCounts();
      if (!current()) return;
      if (unread) {
        const map: Record<string, number> = {};
        let total = 0;
        for (const item of unread) {
          map[item.feedId] = item.count;
          total += item.count;
        }
        setUnreadCounts(map);
        setSmartCounts((prev) => ({ ...prev, unread: total }));
      }
    } catch (error) {
      if (current()) reportError('载入未读数失败', error);
    }
  }, [reportError, unreadRequest]);

  const loadSmartCounts = useCallback(async () => {
    const current = smartRequest();
    try {
      const sincePublishedAt = startOfToday();
      const [today, todayUnread, starred] = await Promise.all([
        window.catpaw?.rss.countEntries({ sincePublishedAt }),
        window.catpaw?.rss.countEntries({ sincePublishedAt, onlyUnread: true }),
        window.catpaw?.rss.countEntries({ onlyStarred: true }),
      ]);
      if (!current()) return;
      setSmartCounts((prev) => ({
        ...prev,
        today: today ?? 0,
        todayUnread: todayUnread ?? 0,
        starred: starred ?? 0,
      }));
    } catch (error) {
      if (current()) reportError('载入智能视图失败', error);
    }
  }, [reportError, smartRequest]);
  useEffect(() => { void loadFeedTree(); void loadUnreadCounts(); }, [loadFeedTree, loadUnreadCounts]);
  useEffect(() => { void loadSmartCounts(); }, [loadSmartCounts]);
  return { groups, feeds, feedsLoaded, unreadCounts, smartCounts, setUnreadCounts, setSmartCounts,
    loadFeedTree, loadUnreadCounts, loadSmartCounts };
}
