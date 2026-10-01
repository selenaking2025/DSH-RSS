export type SmartFeedId = 'today' | 'selected' | 'unread' | 'starred';
export type SmartCounts = Record<Exclude<SmartFeedId, 'selected'>, number> & { todayUnread: number };

export type FeedGroup = {
  id: string;
  name: string;
  parentId: string | null;
};

export type GroupTreeNode = FeedGroup & {
  children: GroupTreeNode[];
};

export type Feed = {
  id: string;
  title: string | null;
  url: string;
  siteUrl: string | null;
  groupId: string | null;
  contentType?: string | null;
  sourceType?: string | null;
  historySyncedAt?: number | null;
  enabled?: number;
  fetchIntervalMinutes?: number | null;
  nextRefreshAt?: number | null;
};

export type FeedSyncState = {
  feedId: string;
  syncStatus: 'active' | 'stale' | 'cooldown' | 'degraded' | 'unknown';
  totalEndpoints: number;
  activeEndpoints: number;
  degradedEndpoints: number;
  cooldownEndpoints: number;
  fallbackEndpoints: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
};

export type SourceEndpointHealth = {
  endpointId: string;
  feedId: string;
  feedTitle: string | null;
  feedUrl: string;
  endpointRole: 'primary' | 'fallback';
  providerType: string;
  providerClass: 'native' | 'bridge' | 'adapter' | 'unknown';
  endpointUrl: string;
  managedBy: 'system' | 'user';
  roleLocked: number;
  endpointHost: string | null;
  endpointStatus: 'active' | 'degraded' | 'cooldown';
  consecutiveFailures: number;
  cooldownUntil: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
};

export type FeedRunDiagnostic = {
  id: string;
  feedId: string;
  feedTitle: string | null;
  feedUrl: string;
  runType: 'refresh' | 'backfill';
  trigger: string;
  status: 'success' | 'failed' | 'not_modified' | 'cancelled';
  providerType: string | null;
  providerClass: 'native' | 'bridge' | 'adapter' | 'unknown';
  endpointHost: string | null;
  newEntries: number;
  error: string | null;
  finishedAt: number;
};

export type XApiFallbackStatus = {
  ok: boolean;
  error?: string;
  configured?: boolean;
  eligible?: boolean;
  enabled?: boolean;
  handle?: string | null;
  tokenFilePath?: string;
};

export type FeedEnrichmentState = {
  feedId: string;
  state: 'healthy' | 'pending' | 'attention' | 'idle';
  totalEntries: number;
  enrichableEntries: number;
  pendingEntries: number;
  fetchingEntries: number;
  fetchedEntries: number;
  noContentEntries: number;
  failedEntries: number;
  authRequiredEntries: number;
  mediaPendingEntries: number;
  lastAttemptedAt: number | null;
  lastFetchedAt: number | null;
};

export type EnrichmentQueueStatus = {
  currentJob: {
    requestId: string;
    kind: 'fetch_entry_content' | 'resolve_xiaoyuzhou_audio' | 'get_social_thread' | 'prepare_article_summary';
    entryId: string;
    enqueuedAt: number;
    startedAt: number;
  } | null;
  queueDepth: number;
  inflightCount: number;
  queuedByKind: {
    fetch_entry_content: number;
    resolve_xiaoyuzhou_audio: number;
    get_social_thread: number;
    prepare_article_summary: number;
  };
  lastFailure: {
    requestId: string;
    priority: 'critical' | 'interactive' | 'scheduled' | 'background';
    message: string;
    failedAt: number;
  } | null;
};

export type Entry = {
  createdAt?: number;
  id: string;
  feedId: string;
  title: string | null;
  link: string | null;
  summary: string | null;
  contentHtml?: string | null;
  contentText?: string | null;
  publishedAt: number | null;
  isRead: number;
  isStarred: number;
  mediaUrl: string | null;
  mediaType: string | null;
  contentLength?: number | null;
  contentFetchStatus?: 'fetching' | 'fetched' | 'no_content' | 'auth_required' | 'failed' | null;
  contentFetchedAt?: number | null;
  contentFetchAttemptedAt?: number | null;
  contentFetchError?: string | null;
};

export type SocialThreadItem = {
  entryId: string;
  tweetId: string;
  link: string;
  publishedAt: number | null;
  text: string;
};

export type EntryAnalysis = import('../../../../electron/contracts/article-summary').ArticleSummary;

export type MediaChapter = {
  timecode: string;
  seconds: number;
  label: string;
};
