import type { SmartFeedId } from './types';

export const smartFeeds: Array<{ id: SmartFeedId; label: string }> = [
  { id: 'today', label: '今天' },
  { id: 'selected', label: '精选' },
  { id: 'unread', label: '全部未读' },
  { id: 'starred', label: '收藏' },
];

export const FEED_DISCOVERY_SOURCE_LABELS: Record<string, string> = {
  'known-platform': '已知平台',
  'direct-feed': '直接订阅地址',
  'html-alternate': '页面声明的订阅地址',
};

export const FETCHING_COOLDOWN_MS = 5 * 60 * 1000;
export const FAILED_FETCH_RETRY_MS = 6 * 60 * 60 * 1000;
export const ENTRY_LIST_LIMIT = 200;
export const LAST_ACTIVE_FEED_STORAGE_KEY = 'catpaw.reader.lastActiveFeedId';
export const HOME_FEED_TITLE_HINT = '42章经';
export const ON_MY_MAC_GROUP_NAMES = ['AI资讯', '财经资讯', 'AI论文'] as const;
export const HIDDEN_GROUP_ACTION_NAMES = new Set<string>(ON_MY_MAC_GROUP_NAMES);
export const ON_MY_MAC_GROUP_RANK = new Map<string, number>(
  ON_MY_MAC_GROUP_NAMES.map((name, index) => [name, index]),
);
export const SIDEBAR_GROUP_RANK = new Map<string, number>(
  ['AI资讯', '技术博客', '财经资讯', 'AI论文'].map((name, index) => [name, index]),
);

export type PrimaryGroupName = (typeof ON_MY_MAC_GROUP_NAMES)[number];
