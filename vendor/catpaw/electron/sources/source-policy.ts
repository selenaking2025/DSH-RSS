import { resolveHtmlArticleListingEndpoint } from './html-listing-metadata';
import { resolveWebCliTwitterHandle } from './twitter-metadata';

export type SourceStrategy = 'rss' | 'html-listing' | 'twitter';
export type SourceIdentity = { url: string; siteUrl: string | null };

export function inferSourceStrategy(feed: SourceIdentity): SourceStrategy {
  if (resolveHtmlArticleListingEndpoint(feed)) return 'html-listing';
  if (resolveWebCliTwitterHandle(feed)) return 'twitter';
  return 'rss';
}
