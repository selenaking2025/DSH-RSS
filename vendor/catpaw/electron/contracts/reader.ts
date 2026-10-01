export type FeedGroup = {
  id: string;
  name: string;
  parentId: string | null;
};

export type Feed = {
  id: string;
  syncRevision: number;
  title: string | null;
  url: string;
  siteUrl: string | null;
  groupId: string | null;
  contentType: string | null;
  sourceType: string | null;
  historySyncedAt: number | null;
  lastCheckedAt: number | null;
  lastModified: string | null;
  etag: string | null;
  contentHash: string | null;
  conditionalGetAt: number | null;
  enabled: number;
  fetchIntervalMinutes: number | null;
  nextRefreshAt: number | null;
};

export type Source = {
  id: string;
  feedId: string;
  title: string | null;
  sourceKind: string;
  createdAt: number;
  updatedAt: number;
};

export type SourceEndpoint = {
  id: string;
  sourceId: string;
  feedId: string;
  endpointRole: 'primary' | 'fallback';
  providerType: string;
  endpointUrl: string;
  endpointHost: string | null;
  endpointStatus: 'active' | 'degraded' | 'cooldown';
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  cooldownUntil: number | null;
  lastError: string | null;
  capabilitiesJson: string | null;
  managedBy: 'system' | 'user';
  roleLocked: number;
  createdAt: number;
  updatedAt: number;
};

export type FeedRunResult = {
  id: string;
  pipelineRunId: string | null;
  feedId: string;
  sourceId: string | null;
  endpointId: string | null;
  runType: 'refresh' | 'backfill';
  trigger: string;
  status: 'success' | 'failed' | 'not_modified' | 'cancelled';
  providerType: string | null;
  endpointHost: string | null;
  notModified: number;
  newEntries: number;
  error: string | null;
  startedAt: number;
  finishedAt: number;
  createdAt: number;
};

export type ProviderClass = 'native' | 'bridge' | 'adapter' | 'unknown';

export type SourceEndpointHealth = {
  endpointId: string;
  feedId: string;
  feedTitle: string | null;
  feedUrl: string;
  providerType: string;
  providerClass: ProviderClass;
  endpointRole: 'primary' | 'fallback';
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
  pipelineRunId: string | null;
  feedId: string;
  feedTitle: string | null;
  feedUrl: string;
  runType: 'refresh' | 'backfill';
  trigger: string;
  status: 'success' | 'failed' | 'not_modified' | 'cancelled';
  providerType: string | null;
  providerClass: ProviderClass;
  endpointHost: string | null;
  notModified: number;
  newEntries: number;
  error: string | null;
  finishedAt: number;
};

export type ProviderHealthSummaryBucket = {
  total: number;
  active: number;
  degraded: number;
  cooldown: number;
};

export type SourceEndpointFailureDomain = {
  endpointHost: string;
  providerType: string | null;
  providerClass: ProviderClass;
  affectedEndpoints: number;
  degradedEndpoints: number;
  cooldownEndpoints: number;
  lastFailureAt: number | null;
};

export type SourceEndpointHealthSummary = {
  totalEndpoints: number;
  byProviderClass: Record<ProviderClass, ProviderHealthSummaryBucket>;
  failureDomains: SourceEndpointFailureDomain[];
};

export type FeedFailureSummary = {
  windowHours: number;
  windowStartAt: number;
  totalFailures: number;
  byProviderClass: Record<ProviderClass, number>;
};

export type RefreshEndpointCandidate = {
  endpointId: string;
  feedId: string;
  sourceId: string;
  endpointRole: 'primary' | 'fallback';
  providerType: string;
  providerClass: ProviderClass;
  endpointUrl: string;
  endpointHost: string | null;
  endpointStatus: 'active' | 'degraded' | 'cooldown';
  cooldownUntil: number | null;
  lastError: string | null;
  managedBy: 'system' | 'user';
  roleLocked: number;
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

export type Entry = {
  id: string;
  feedId: string;
  guid: string | null;
  title: string | null;
  link: string | null;
  author: string | null;
  publishedAt: number | null;
  summary: string | null;
  contentHtml: string | null;
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  isRead: number;
  isStarred: number;
  createdAt: number;
  contentLength?: number | null;
  contentFetchStatus?: 'fetching' | 'fetched' | 'no_content' | 'auth_required' | 'failed' | null;
  contentFetchedAt?: number | null;
  contentFetchAttemptedAt?: number | null;
  contentFetchError?: string | null;
};

export type EntryListItem = {
  id: string;
  feedId: string;
  title: string | null;
  link: string | null;
  summary: string | null;
  publishedAt: number | null;
  mediaUrl: string | null;
  mediaType: string | null;
  isRead: number;
  isStarred: number;
  createdAt: number;
  contentLength: number;
  contentFetchStatus?: 'fetching' | 'fetched' | 'no_content' | 'auth_required' | 'failed' | null;
  contentFetchedAt?: number | null;
  contentFetchAttemptedAt?: number | null;
  contentFetchError?: string | null;
};

export type PipelineRunType = 'refresh' | 'backfill';
export type PipelineRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type PipelineRun = {
  id: string;
  runType: PipelineRunType;
  trigger: string;
  status: PipelineRunStatus;
  startedAt: number;
  finishedAt: number | null;
  totalFeeds: number;
  feedsCompleted: number;
  feedsSucceeded: number;
  feedsFailed: number;
  newEntries: number;
  error: string | null;
  metadataJson: string | null;
};

export type EntryCursor = { sortAt: number; createdAt: number; id: string };
