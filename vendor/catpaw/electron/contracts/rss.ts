import type { RssBatchJobOptions as BatchJobOptions, SchedulerStatus } from './rss-jobs';
import type { ReaderJobStatus } from './reader-worker';

import type { Feed, Entry, EntryListItem, EntryCursor, ProviderClass, PipelineRunType } from './reader';
import type { RssRunOutcome } from './feed-run';
import type { ModelProvider, ModelProviderResult, SaveModelProviderInput, DiscoverProviderModelsInput } from './model-providers';
import type { TranslateArticleInput, TranslateArticleResult, TranslationProgress } from './translation';
import type { ArticleSummary, ArticleSummaryResult, SummarizeArticleInput } from './article-summary';
import type { ThemePreference } from './appearance';
import type { ReaderStateChange } from './reader-events';
import type { MaintenanceStatus } from './maintenance';
import type { AppUpdateStatus, AppUpdateResult } from './app-update';
import type { DecisionSettings, SaveDecisionSettings } from './decision';
import type { ReadingFocus, SaveReadingFocus, ReadingFeedback, ReadingRunInput, ReadingStatus, ReadingSnapshot, ReadingQuery, ReadingChange, ReadingResult } from './smart-reading';
export type RssBridge = {
  getReadingSettings: () => Promise<ReadingResult<{ settings: DecisionSettings; usage: { inputTokens: number; requests: number } }>>;
  saveReadingSettings: (input: SaveDecisionSettings) => Promise<ReadingResult<DecisionSettings>>;
  testReadingConnection: () => Promise<ReadingResult<{ model: string; inputTokens: number }>>;
  listReadingFocuses: () => Promise<ReadingResult<ReadingFocus[]>>;
  saveReadingFocus: (input: SaveReadingFocus) => Promise<ReadingResult<ReadingFocus>>;
  getReadingStatus: () => Promise<ReadingStatus | null>;
  startReadingRun: (input: ReadingRunInput) => Promise<ReadingResult<ReadingStatus>>;
  cancelReadingRun: () => Promise<void>;
  getReadingResults: (input: ReadingRunInput & { focusId: string }) => Promise<ReadingResult<ReadingSnapshot>>;
  saveReadingFeedback: (input: { entryId: string; focusId: string; value: ReadingFeedback | null }) => Promise<ReadingResult<void>>;
  recordReadingVisit: (entryId: string) => Promise<ReadingResult<void>>;
  splitReadingEvent: (input: { leftId: string; rightId: string }) => Promise<ReadingResult<void>>;
  parseReadingQuery: (text: string) => Promise<ReadingResult<ReadingQuery>>;
  onReadingChanged: (listener: (change: ReadingChange) => void) => () => void;
  getMaintenanceStatus: () => Promise<MaintenanceStatus | null>;
  getThemePreference: () => Promise<ThemePreference>;
  setThemePreference: (preference: ThemePreference) => Promise<ThemePreference>;
  translateArticle: (input: TranslateArticleInput) => Promise<TranslateArticleResult>;
  cancelArticleTranslation: (requestId: string) => Promise<void>;
  onTranslationProgress: (listener: (progress: TranslationProgress) => void) => () => void;
  listModelProviders: () => Promise<ModelProviderResult<ModelProvider[]>>;
  saveModelProvider: (input: SaveModelProviderInput) => Promise<ModelProviderResult<ModelProvider[]>>;
  removeModelProvider: (id: string) => Promise<ModelProviderResult<ModelProvider[]>>;
  discoverProviderModels: (input: DiscoverProviderModelsInput) => Promise<ModelProviderResult<string[]>>;
  getAppStatus: () => Promise<{ version: string; electron: string; schema: number; packaged: boolean }>;
  backupDatabase: () => Promise<{ ok: boolean; error?: string; filePath?: string }>;
  restoreDatabase: () => Promise<{ ok: boolean; error?: string }>;
  exportDiagnostics: () => Promise<{ ok: boolean; error?: string; filePath?: string }>;
  rebuildSearchIndex: () => Promise<{ ok: boolean; entries: number }>;
  getUpdateStatus: () => Promise<AppUpdateStatus>;
  checkForUpdates: () => Promise<AppUpdateResult>;
  downloadUpdate: () => Promise<AppUpdateResult>;
  installUpdate: () => Promise<AppUpdateResult>;
  onUpdateStatusChanged: (listener: (status: AppUpdateStatus) => void) => () => void;
  listGroups: () => Promise<Array<{ id: string; name: string; parentId: string | null }>>;
  listFeeds: () => Promise<Feed[]>;
  countEntries: (params?: {
    feedId?: string | null;
    createdAfter?: number | null;
    createdBefore?: number | null;
    onlyStarred?: boolean;
    onlyUnread?: boolean;
    sincePublishedAt?: number | null;
  }) => Promise<number>;
  listEntries: (params: {
    cursor?: EntryCursor | null;
    feedId?: string | null;
    onlyUnread?: boolean;
    onlyStarred?: boolean;
    search?: string | null;
    since?: number | null;
    limit?: number | null;
    offset?: number | null;
    mode?: 'list' | 'full';
  }) => Promise<Array<Entry | EntryListItem>>;
  getEntry: (id: string) => Promise<Entry | null>;
  getUnreadCounts: () => Promise<Array<{ feedId: string; count: number }>>;
  getSchedulerStatus: () => Promise<SchedulerStatus>;
  getRefreshSettings: () => Promise<{
    enabled: boolean;
    dailyTime: string;
    catchUpMissed: boolean;
    historyStartYear: number;
    historyMaxPagesPerFeed: number;
  }>;
  updateRefreshSettings: (input: {
    enabled?: boolean;
    dailyTime?: string;
    catchUpMissed?: boolean;
    historyStartYear?: number;
    historyMaxPagesPerFeed?: number;
  }) => Promise<{
    ok: boolean;
    error?: string;
    settings?: {
      enabled: boolean;
      dailyTime: string;
      catchUpMissed: boolean;
      historyStartYear: number;
      historyMaxPagesPerFeed: number;
    };
  }>;
  listPipelineRuns: (params?: {
    runType?: PipelineRunType | null;
    limit?: number | null;
  }) => Promise<Array<{
    id: string;
    runType: PipelineRunType;
    trigger: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    startedAt: number;
    finishedAt: number | null;
    totalFeeds: number;
    feedsCompleted: number;
    feedsSucceeded: number;
    feedsFailed: number;
    newEntries: number;
    error: string | null;
    metadataJson: string | null;
  }>>;
  listSourceEndpointHealth: (params?: {
    status?: 'active' | 'degraded' | 'cooldown' | null;
    limit?: number | null;
  }) => Promise<Array<{
    endpointId: string;
    feedId: string;
    feedTitle: string | null;
    feedUrl: string;
    endpointRole: 'primary' | 'fallback';
    providerType: string;
    providerClass: ProviderClass;
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
  }>>;
  resetSourceEndpointHealth: (endpointId: string) => Promise<{ ok: boolean; error?: string }>;
  getXApiFallbackStatus: (feedId: string) => Promise<{
    ok: boolean;
    error?: string;
    configured?: boolean;
    eligible?: boolean;
    enabled?: boolean;
    handle?: string | null;
    tokenFilePath?: string;
  }>;
  setXApiFallbackEnabled: (input: { feedId: string; enabled: boolean }) => Promise<{
    ok: boolean;
    error?: string;
    configured?: boolean;
    eligible?: boolean;
    enabled?: boolean;
    handle?: string | null;
    tokenFilePath?: string;
  }>;
  listFeedRunDiagnostics: (params?: {
    status?: 'success' | 'failed' | 'not_modified' | 'cancelled' | null;
    providerClass?: ProviderClass | null;
    limit?: number | null;
  }) => Promise<Array<{
    id: string;
    pipelineRunId: string | null;
    feedId: string;
    feedTitle: string | null;
    feedUrl: string;
    runType: PipelineRunType;
    trigger: string;
    status: 'success' | 'failed' | 'not_modified' | 'cancelled';
    providerType: string | null;
    providerClass: ProviderClass;
    endpointHost: string | null;
    notModified: number;
    newEntries: number;
    error: string | null;
    finishedAt: number;
  }>>;
  listFeedSyncStates: (params?: {
    feedIds?: string[] | null;
  }) => Promise<Array<{
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
  }>>;
  listFeedEnrichmentStates: (params?: {
    feedIds?: string[] | null;
  }) => Promise<Array<{
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
  }>>;
  getEnrichmentQueueStatus: () => Promise<ReaderJobStatus>;
  markRead: (id: string, isRead: boolean) => Promise<void>;
  markAllRead: (feedId?: string) => Promise<number>;
  toggleStar: (id: string) => Promise<number>;
  fetchEntryContent: (id: string) => Promise<{ ok: boolean; error?: string }>;
  resolveXiaoyuzhouAudio: (id: string) => Promise<{ ok: boolean; mediaUrl?: string; error?: string }>;
  openWeChatLogin: () => Promise<{ ok: boolean; error?: string; alreadyOpen?: boolean }>;
  getSocialThread: (id: string) => Promise<{
    ok: boolean;
    error?: string;
    items?: Array<{
      entryId: string;
      tweetId: string;
      link: string;
      publishedAt: number | null;
      text: string;
    }>;
  }>;
  getArticleSummary: (entryId: string) => Promise<ArticleSummary | null>;
  cancelArticleSummary: (requestId: string) => Promise<void>;
  analyzeEntry: (input: SummarizeArticleInput) => Promise<ArticleSummaryResult>;
  createGroup: (name: string, parentId?: string | null) => Promise<string>;
  updateGroup: (input: {
    id: string;
    name?: string;
    parentId?: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  deleteGroup: (id: string) => Promise<{
    ok: boolean;
    error?: string;
    movedFeeds?: number;
    movedGroups?: number;
  }>;
  refreshAll: (options?: BatchJobOptions) => Promise<RssRunOutcome>;
  refreshFeed: (id: string) => Promise<RssRunOutcome>;
  backfillFeed: (
    id: string,
    options?: { since?: number | null; maxPages?: number | null },
  ) => Promise<RssRunOutcome>;
  cancelActiveJobs: () => Promise<{
    ok: boolean;
    cancelledQueued: number;
    cancellingCurrent: boolean;
  }>;
  backfillAll: (options?: BatchJobOptions) => Promise<RssRunOutcome>;
  discoverFeeds: (input: string) => Promise<{
    ok: boolean;
    siteUrl?: string;
    candidates: Array<{
      url: string;
      title: string | null;
      siteUrl: string | null;
      source: 'known-platform' | 'direct-feed' | 'html-alternate';
    }>;
    warning?: string;
    error?: string;
  }>;
  addFeed: (input: {
    url: string;
    title?: string | null;
    groupId?: string | null;
  }) => Promise<{
    ok: boolean;
    error?: string;
    warning?: string;
    newEntries?: number;
    pages?: number;
    scannedItems?: number;
    reachedBoundary?: boolean;
  }>;
  updateFeed: (input: {
    id: string;
    url?: string;
    title?: string | null;
    siteUrl?: string | null;
    groupId?: string | null;
    confirmUrlChange?: boolean;
    enabled?: boolean;
    fetchIntervalMinutes?: number | null;
  }) => Promise<{
    ok: boolean;
    error?: string;
    warning?: string;
    urlChanged?: boolean;
  }>;
  deleteFeed: (id: string) => Promise<{ ok: boolean; error?: string }>;
  previewOpml: (options?: {
    groupId?: string | null;
    token?: string | null;
  }) => Promise<{
    ok: boolean;
    token?: string;
    filePath?: string;
    fileName?: string;
    newGroupCount?: number;
    reusedGroupCount?: number;
    newFeedCount?: number;
    existingFeedCount?: number;
    duplicateFeedCount?: number;
    invalidFeedCount?: number;
    error?: string;
  }>;
  importOpml: (options?: {
    groupId?: string | null;
    token?: string | null;
  }) => Promise<{
    ok: boolean;
    filePath?: string;
    fileName?: string;
    groupCount?: number;
    feedCount?: number;
    feedIds?: string[];
    newGroupCount?: number;
    reusedGroupCount?: number;
    newFeedCount?: number;
    existingFeedCount?: number;
    duplicateFeedCount?: number;
    invalidFeedCount?: number;
    error?: string;
  }>;
  onStateChanged: (listener: (change: ReaderStateChange) => void) => () => void;
  exportOpml: () => Promise<{ ok: boolean; filePath?: string; error?: string }>;
};

export type RssEventMethod = 'onStateChanged' | 'onTranslationProgress' | 'onUpdateStatusChanged' | 'onReadingChanged';
export type RssInvokeMethod = Exclude<keyof RssBridge, RssEventMethod>;
export type RssResult<K extends RssInvokeMethod> = Awaited<ReturnType<RssBridge[K]>>;
