import { resolveWebCliTwitterHandle } from '../sources/twitter-metadata';
import { withTwitterSession, type TwitterSession } from '../integrations/twitter/session';
import type { Tweet } from '../integrations/twitter/parse';
import { buildPostTitle, buildBasicTweetContentHtml, buildTweetDetailContentHtml } from '../integrations/twitter/content';
import { classifyFeedError, feedFailure } from '../feed-errors';
import { getFeedSyncTarget, type FeedSyncTarget } from '../data/feed-sync-repo';
import { listFeedEntryLinks, updateFeedFetchMeta, updateFeedHistorySyncedAt } from '../data/feed-write-repo';
import { upsertEntry } from '../data/entry-repo';
export { buildWebCliTwitterEndpointUrl, resolveWebCliTwitterHandle } from '../sources/twitter-metadata';
export { resetWebCliTwitterStateForTests } from '../integrations/twitter/session';

const DEFAULT_TWEET_COUNT = 10;
const MAX_TWEET_COUNT = 25;
const BACKFILL_PAGE_SIZE = 40;
const BACKFILL_MAX_PAGES = 300;
const HISTORY_START_AT = new Date(2023, 0, 1).getTime();
const TWEET_LINK_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/(?:(?:i\/web\/status)|(?:[A-Za-z0-9_]{1,30}\/status))\/(\d+)/i;

type TwitterFeedInput = {
  syncTarget?: FeedSyncTarget;
  feedId: string;
  endpointUrl: string;
  siteUrl?: string | null;
  url?: string | null;
};

function requireHandle(input: TwitterFeedInput) {
  const handle = resolveWebCliTwitterHandle(input);
  if (!handle) throw new Error('WEB_CLI_TWITTER_HANDLE_NOT_FOUND');
  return handle;
}

function extractNewestKnownTweetId(feedId: string) {
  for (const link of listFeedEntryLinks(feedId, 10)) {
    const match = link.match(TWEET_LINK_REGEX);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function enrichTweets(session: TwitterSession, tweets: Tweet[], newestKnownId: string | null) {
  // Details are optional enrichment. Cancellation and local failures still end the job.
  const enriched = [...tweets];
  for (let index = 0; index < Math.min(tweets.length, MAX_TWEET_COUNT); index++) {
    const tweet = tweets[index]!;
    if (tweet.id === newestKnownId) break;
    try {
      const detail = await session.detail(tweet.id);
      enriched[index] = { ...tweet, contentHtml: buildTweetDetailContentHtml(detail, tweet) };
    } catch (error) {
      const kind = classifyFeedError(error);
      if (kind !== 'provider' && kind !== 'timeout') throw error;
    }
  }
  return enriched;
}

function persistTweets(feedId: string, tweets: Tweet[], syncTarget: FeedSyncTarget) {
  for (const tweet of tweets) {
    upsertEntry({
      feedId,
      syncTarget,
      guid: `tweet:${tweet.id}`,
      title: buildPostTitle(tweet.text, tweet.username),
      link: `https://x.com/${tweet.username}/status/${tweet.id}`,
      author: `@${tweet.username}`,
      publishedAt: tweet.publishedAt,
      summary: tweet.text,
      contentHtml: tweet.contentHtml ?? buildBasicTweetContentHtml(tweet),
      mediaUrl: tweet.mediaUrls[0] ?? null,
      mediaType: tweet.mediaUrls.length > 0 ? 'image' : null,
    });
  }
}

export async function refreshWebCliTwitterFeed(input: TwitterFeedInput & { count?: number | null }) {
  const syncTarget = input.syncTarget ?? getFeedSyncTarget(input.feedId);
  return withTwitterSession(requireHandle(input), async (session) => {
    const count = Math.max(5, Math.min(MAX_TWEET_COUNT, Math.floor(input.count ?? DEFAULT_TWEET_COUNT)));
    const page = await session.timeline({ count });
    const newestKnownId = extractNewestKnownTweetId(input.feedId);
    const tweets = await enrichTweets(session, page.tweets, newestKnownId);
    persistTweets(input.feedId, tweets, syncTarget);
    updateFeedFetchMeta(input.feedId, { lastCheckedAt: Date.now() }, syncTarget);
    return { feedId: input.feedId, notModified: tweets[0]?.id === newestKnownId };
  });
}

export async function backfillWebCliTwitterFeed(input: TwitterFeedInput & { since?: number | null; maxPages?: number | null }) {
  const syncTarget = input.syncTarget ?? getFeedSyncTarget(input.feedId);
  const since = typeof input.since === 'number' && Number.isFinite(input.since) && input.since >= 0
    ? Math.floor(input.since) : HISTORY_START_AT;
  const maxPages = input.maxPages && !Number.isNaN(input.maxPages)
    ? Math.min(BACKFILL_MAX_PAGES, Math.max(1, Math.floor(input.maxPages))) : BACKFILL_MAX_PAGES;
  let pages = 0;
  let scannedItems = 0;
  let reachedBoundary = false;
  try {
    return await withTwitterSession(requireHandle(input), async (session) => {
      const seen = new Set<string>();
      let cursor: string | null = null;
      let historyEnd: 'end' | 'limit' | 'boundary' = 'end';
      pages = 0;
      scannedItems = 0;
      reachedBoundary = false;
      while (pages < maxPages) {
        const page = await session.timeline({ count: BACKFILL_PAGE_SIZE, cursor });
        pages += 1;
        if (page.tweets.length === 0) break;
        const eligible = page.tweets.filter((tweet) => {
          if (seen.has(tweet.id)) return false;
          seen.add(tweet.id);
          if (tweet.publishedAt && tweet.publishedAt < since) {
            reachedBoundary = true;
            return false;
          }
          return true;
        });
        persistTweets(input.feedId, eligible, syncTarget);
        scannedItems += eligible.length;
        if (reachedBoundary) { historyEnd = 'boundary'; break; }
        if (!page.cursor || page.cursor === cursor) break;
        cursor = page.cursor;
        if (pages === maxPages) historyEnd = 'limit';
      }
      const now = Date.now();
      updateFeedFetchMeta(input.feedId, { lastCheckedAt: now }, syncTarget);
      updateFeedHistorySyncedAt(input.feedId, now, syncTarget);
      return { feedId: input.feedId, pages, scannedItems, reachedBoundary, historyEnd };
    });
  } catch (error) {
    return { ...feedFailure(error), feedId: input.feedId, pages, scannedItems, reachedBoundary };
  }
}
