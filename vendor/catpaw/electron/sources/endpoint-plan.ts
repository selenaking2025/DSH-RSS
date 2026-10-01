import type { SourceCapabilities } from '../contracts/source-capabilities';
import { resolvePreferredFetchUrl } from './rsshub';
import {
  buildWeChatNativeListingUrl,
  extractWeChatBizFromUrl,
  isWeChatNativeCandidate,
} from './wechat-metadata';
import { resolveHtmlArticleListingEndpoint } from './html-listing-metadata';
import {
  buildWebCliTwitterEndpointUrl,
  resolveWebCliTwitterHandle,
} from './twitter-metadata';
import { inferSourceStrategy, type SourceStrategy } from './source-policy';

export type FeedSnapshot = {
  id: string;
  title: string | null;
  url: string;
  siteUrl: string | null;
  contentType: string | null;
  sourceType: string | null;
  sourceStrategy?: SourceStrategy;
};

export function buildDesiredListingEndpoints(feed: FeedSnapshot, capabilities: SourceCapabilities) {
  const strategy = feed.sourceStrategy ?? inferSourceStrategy(feed);
  const htmlListingUrl = strategy === 'html-listing' && resolveHtmlArticleListingEndpoint({
    siteUrl: feed.siteUrl,
    url: feed.url,
  });
  if (htmlListingUrl) {
    return [
      {
        endpointRole: 'primary' as const,
        endpointUrl: htmlListingUrl,
        providerType: 'html-article-listing',
      },
      {
        endpointRole: 'fallback' as const,
        endpointUrl: feed.url,
        providerType: feed.sourceType,
      },
    ];
  }

  const preferWebCliForX = (endpoints: Array<{
    endpointRole: 'primary' | 'fallback';
    endpointUrl: string;
    providerType?: string | null;
  }>) => {
    if (!capabilities.webCliTwitter || strategy !== 'twitter') {
      return endpoints;
    }

    const handle = resolveWebCliTwitterHandle({
      siteUrl: feed.siteUrl,
      url: feed.url,
    });
    if (!handle) {
      return endpoints;
    }

    return [
      {
        endpointRole: 'primary' as const,
        endpointUrl: buildWebCliTwitterEndpointUrl(handle),
        providerType: 'web-cli-twitter',
      },
    ];
  };


  if (isWeChatNativeCandidate({
    sourceType: feed.sourceType,
    url: feed.url,
    siteUrl: feed.siteUrl,
  })) {
    const biz = extractWeChatBizFromUrl(feed.siteUrl) ?? extractWeChatBizFromUrl(feed.url);
    if (biz) {
      return preferWebCliForX([
        {
          endpointRole: 'primary' as const,
          endpointUrl: buildWeChatNativeListingUrl(biz),
          providerType: 'wechat-native-listing',
        },
        {
          endpointRole: 'fallback' as const,
          endpointUrl: feed.url,
          providerType: feed.sourceType,
        },
      ]);
    }
  }

  const preferredUrl = resolvePreferredFetchUrl(feed.url, feed.siteUrl);
  if (preferredUrl && preferredUrl !== feed.url) {
    return preferWebCliForX([
      {
        endpointRole: 'primary' as const,
        endpointUrl: preferredUrl,
      },
      {
        endpointRole: 'fallback' as const,
        endpointUrl: feed.url,
        providerType: feed.sourceType,
      },
    ]);
  }

  return preferWebCliForX([
    {
      endpointRole: 'primary' as const,
      endpointUrl: feed.url,
      providerType: feed.sourceType,
    },
  ]);
}
