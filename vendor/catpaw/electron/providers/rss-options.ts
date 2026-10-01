import type { RssHistoryCursor } from '../contracts/rss-history';
import type { FeedSyncTarget } from '../data/feed-sync-repo';

export type RssFetchOptions = {
  historyCursor?: RssHistoryCursor;
  historyStepPages?: number;
  syncTarget?: FeedSyncTarget;
  title?: string | null;
  groupId?: string | null;
  siteUrl?: string | null;
  fetchUrl?: string | null;
  endpointManaged?: boolean;
  useNativeHistoryApi?: boolean;
  backfill?: boolean;
  backfillUntil?: number | null;
  maxBackfillPages?: number | null;
  // Cooperative cancellation: checked between pages so a long backfill can be
  // stopped without killing the worker mid-write.
  shouldStop?: () => boolean;
};
