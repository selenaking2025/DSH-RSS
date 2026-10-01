import type { RssHistoryCursor } from '../../contracts/rss-history';
import type { Feed, RefreshEndpointCandidate } from '../../data/db-types';
import { countEntries } from '../../data/entry-read-repo';
import { getFeedFetchMetaByUrl } from '../../data/feed-write-repo';
import { canPageIntoHistory } from '../../sources/endpoint-utils';
import { refreshFeed, backfillFeedById } from '../rss';
import { refreshHtmlArticleListing } from '../html-article-listing';
import { refreshWeChatNativeListing } from '../wechat-native-listing';
import { refreshWebCliTwitterFeed, backfillWebCliTwitterFeed } from '../web-cli-twitter';
import { refreshXApiTwitterFeed } from '../x-api-twitter';
import { checkFeedSyncTarget } from '../../data/feed-sync-repo';
import { currentRequestBudget } from '../../network/http';
import { feedFailure } from '../../feed-errors';
import type { FeedFailureKind } from '../../contracts/feed-run';

const defaults = { refreshFeed, backfillFeedById, refreshHtmlArticleListing, refreshWeChatNativeListing,
  refreshWebCliTwitterFeed, backfillWebCliTwitterFeed, refreshXApiTwitterFeed };
export type BackfillHandlers = Pick<typeof defaults, 'backfillFeedById' | 'refreshHtmlArticleListing' |
  'refreshWeChatNativeListing' | 'backfillWebCliTwitterFeed'> & Partial<Pick<typeof defaults, 'refreshXApiTwitterFeed'>>;
type AdapterResult = { historyContinuation?: RssHistoryCursor; ok?: boolean; error?: string; errorKind?: FeedFailureKind; cancelled?: boolean; feedId?: string | null; notModified?: boolean;
  pages?: number; scannedItems?: number; reachedBoundary?: boolean; historyEnd?: 'end' | 'limit' | 'boundary' };
export type EndpointAttemptResult = AdapterResult & { endpointId: string | null; endpointUrl: string;
  resolvedFeedId: string; ok: boolean; newEntries?: number; historyCapable?: boolean };
export type SourceAdapterInput = { mode: 'refresh' | 'backfill'; feed: Feed; endpoint: RefreshEndpointCandidate | null;
  allowCreate: boolean; history?: { since?: number | null; maxPages?: number | null; historyCursor?: RssHistoryCursor; historyStepPages?: number };
  startedAt: number; shouldStop: () => boolean };

/** This registry owns provider dispatch. Endpoint selection and health remain with the run service. */
export async function executeSourceAdapter(input: SourceAdapterInput, overrides: Partial<typeof defaults> = {}): Promise<EndpointAttemptResult> {
  const { feed, endpoint, mode, shouldStop } = input;
  const stopped = () => shouldStop() || Boolean(currentRequestBudget()?.shouldStop?.());
  const handlers = { ...defaults, ...overrides };
  const syncTarget = input.allowCreate ? undefined : { id: feed.id, url: feed.url, revision: feed.syncRevision };
  const shared = { feedId: feed.id, syncTarget, endpointUrl: endpoint?.endpointUrl ?? feed.url,
    siteUrl: feed.siteUrl, url: feed.url };
  const history = input.history ?? {};
  const rssOptions = { syncTarget, fetchUrl: endpoint?.endpointUrl, endpointManaged: Boolean(endpoint),
    useNativeHistoryApi: !endpoint || endpoint.providerType === 'xiaoyuzhou-native', shouldStop };
  const registry: Record<string, { refresh: () => Promise<AdapterResult>; backfill?: () => Promise<AdapterResult> }> = {
    'html-article-listing': { refresh: () => handlers.refreshHtmlArticleListing(shared) },
    'wechat-native-listing': { refresh: () => handlers.refreshWeChatNativeListing(shared) },
    'web-cli-twitter': { refresh: () => handlers.refreshWebCliTwitterFeed(shared),
      backfill: () => handlers.backfillWebCliTwitterFeed({ ...shared, ...history }) },
    'x-api-twitter': { refresh: () => handlers.refreshXApiTwitterFeed(shared) },
  };
  const rss = {
    refresh: async () => await handlers.refreshFeed(feed.url, { ...rssOptions,
      title: feed.title, groupId: feed.groupId,
      siteUrl: shared.siteUrl }) ?? { ok: false, error: 'SOURCE_EMPTY_RESULT' },
    backfill: () => handlers.backfillFeedById(feed.id, { ...rssOptions, ...history }),
  };
  const adapter = registry[endpoint?.providerType ?? ''] ?? rss;
  const base = { endpointId: endpoint?.endpointId ?? null, endpointUrl: shared.endpointUrl, resolvedFeedId: feed.id };
  const initialFeedId = input.allowCreate ? getFeedFetchMetaByUrl(feed.url)?.id ?? feed.id : feed.id;
  const entriesBefore = countEntries({ feedId: initialFeedId });
  try {
    if (stopped()) throw new Error('CANCELLED');
    if (syncTarget) checkFeedSyncTarget(syncTarget);
    const result = mode === 'backfill' && adapter.backfill ? await adapter.backfill() : await adapter.refresh();
    if (syncTarget) checkFeedSyncTarget(syncTarget);
    const resolvedFeedId = result.feedId ?? feed.id;
    const newEntries = Math.max(0, countEntries({ feedId: resolvedFeedId }) - entriesBefore);
    if (stopped()) return { ...base, ...result, newEntries, ...feedFailure('CANCELLED', 'cancelled') };
    if (result.ok === false) return { ...base, ...result, newEntries, ...feedFailure(result.error ?? 'SOURCE_FAILED', result.errorKind) };
    const historyCapable = Boolean(adapter.backfill) && canPageIntoHistory(endpoint?.providerType);
    return { ...base, ...result, resolvedFeedId, ok: true, newEntries,
      ...(mode === 'backfill' ? { historyCapable, pages: result.pages ?? 1,
        scannedItems: result.scannedItems ?? newEntries, reachedBoundary: result.reachedBoundary ?? false } : {}) };
  } catch (error) {
    // An obsolete source must not poison the health of its replacement.
    try { if (syncTarget) checkFeedSyncTarget(syncTarget); } catch (changed) { error = changed; }
    return { ...base, ...feedFailure(error) };
  }
}
