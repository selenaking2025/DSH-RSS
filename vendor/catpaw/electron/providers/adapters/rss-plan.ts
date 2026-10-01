import type { RssFetchOptions } from '../rss-options';
import { listFeedEntryLinks } from '../../data/feed-write-repo';
import { dedupeUrls, toRsshubAppVariant } from '../../sources/source-url-utils';
import { buildXiaoyuzhouBackfillSeedUrls, discoverXiaoyuzhouFeedUrls } from './xiaoyuzhou-history';
import { extractXiaoyuzhouPodcastIdFromUrl, inferRsshubBaseFromFeedUrl, isWeChat2RssFeedUrl,
  resolveBackfillFetchUrl, resolvePreferredFetchUrl, resolveWeChatBackfillUrlFromEntryLink } from '../../sources/rsshub';

function buildBackfillSeedUrls(input: {
  url: string;
  siteUrl?: string | null;
  localWeChatBackfillUrl?: string | null;
}) {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (candidate?: string | null) => {
    if (!candidate) return;
    const key = candidate.trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    urls.push(key);
  };

  push(input.localWeChatBackfillUrl ?? null);
  push(resolveBackfillFetchUrl(input.url, input.siteUrl ?? null));
  push(input.url);
  push(resolvePreferredFetchUrl(input.url, input.siteUrl ?? null));

  const snapshot = [...urls];
  for (const candidate of snapshot) {
    push(toRsshubAppVariant(candidate));
  }
  return urls;
}

export async function createRssFetchPlan(url: string, meta: RssFetchOptions | undefined, existingId?: string) {
  const isBackfill = Boolean(meta?.backfill);
  const xiaoyuzhouPodcastId = extractXiaoyuzhouPodcastIdFromUrl(url) ?? extractXiaoyuzhouPodcastIdFromUrl(meta?.siteUrl ?? null);
  const sourceRsshubBase = inferRsshubBaseFromFeedUrl(url);
  let localWeChatFallbackUrl: string | null = null;
  if (isWeChat2RssFeedUrl(url) && existingId) {
    const recentLinks = listFeedEntryLinks(existingId, 60);
    for (const link of recentLinks) {
      const candidate = resolveWeChatBackfillUrlFromEntryLink(link, sourceRsshubBase);
      if (candidate) {
        localWeChatFallbackUrl = candidate;
        break;
      }
    }
  }

  const preferredFetchUrl = meta?.fetchUrl ??
    (isBackfill
      ? (localWeChatFallbackUrl ?? resolveBackfillFetchUrl(url, meta?.siteUrl ?? null))
      : resolvePreferredFetchUrl(url, meta?.siteUrl ?? null));
  const shouldDiscoverXiaoyuzhouFeedUrls = Boolean(!meta?.endpointManaged && xiaoyuzhouPodcastId && (isBackfill || !existingId));
  const discoveredXiaoyuzhouFeedUrls = shouldDiscoverXiaoyuzhouFeedUrls
    ? await discoverXiaoyuzhouFeedUrls({
      podcastId: xiaoyuzhouPodcastId!,
      feedUrl: url,
      siteUrl: meta?.siteUrl ?? null,
    })
    : [];

  // meta.fetchUrl carries the source endpoint the caller selected. In backfill mode
  // it used to be dropped entirely, which made every endpoint of a feed produce the
  // same fetch plan; it must lead the seed list while the derived mirrors stay on as
  // fallbacks, since those are what give most feeds any history depth at all.
  const baseSeedUrls = isBackfill
    ? dedupeUrls([
      meta?.fetchUrl ?? null,
      ...buildBackfillSeedUrls({ url, siteUrl: meta?.siteUrl ?? null, localWeChatBackfillUrl: localWeChatFallbackUrl }),
    ])
    : [preferredFetchUrl];
  const wechatResolvedBackfillUrl = !isBackfill && isWeChat2RssFeedUrl(url)
    ? resolveBackfillFetchUrl(url, meta?.siteUrl ?? null)
    : null;
  const wechatRefreshSeedUrls = !isBackfill && isWeChat2RssFeedUrl(url)
    ? dedupeUrls([
      localWeChatFallbackUrl,
      wechatResolvedBackfillUrl,
      wechatResolvedBackfillUrl ? toRsshubAppVariant(wechatResolvedBackfillUrl) : null,
      toRsshubAppVariant(url),
    ])
    : [];
  const xiaoyuzhouSeedUrls = xiaoyuzhouPodcastId
    ? buildXiaoyuzhouBackfillSeedUrls({ podcastId: xiaoyuzhouPodcastId, feedUrl: url })
    : [];
  const pendingSeedUrls = meta?.endpointManaged && meta.fetchUrl ? [meta.fetchUrl] : dedupeUrls(
    meta?.fetchUrl
      ? [...baseSeedUrls, ...wechatRefreshSeedUrls, ...discoveredXiaoyuzhouFeedUrls, ...xiaoyuzhouSeedUrls]
      : isBackfill
        ? [...discoveredXiaoyuzhouFeedUrls, ...xiaoyuzhouSeedUrls, ...baseSeedUrls]
        : [...baseSeedUrls, ...wechatRefreshSeedUrls, ...discoveredXiaoyuzhouFeedUrls, ...xiaoyuzhouSeedUrls],
  );
  return { pendingSeedUrls, sourceRsshubBase };
}
