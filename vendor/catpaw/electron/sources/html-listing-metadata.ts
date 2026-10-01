
type HtmlListingProfileKey = 'anthropic-news' | 'anthropic-research' | 'the-batch';

export type HtmlListingProfile = {
  key: HtmlListingProfileKey;
  siteHost: string;
  listingPathPrefix: string;
  articlePathPrefix: string;
  excludedPathPrefixes: string[];
};


const HTML_LISTING_PROFILES: HtmlListingProfile[] = [
  {
    key: 'anthropic-news',
    siteHost: 'anthropic.com',
    listingPathPrefix: '/news',
    articlePathPrefix: '/news/',
    excludedPathPrefixes: ['/newsroom', '/careers', '/press'],
  },
  {
    key: 'anthropic-research',
    siteHost: 'anthropic.com',
    listingPathPrefix: '/research',
    articlePathPrefix: '/research/',
    excludedPathPrefixes: ['/research/engineering', '/research/index'],
  },
  {
    key: 'the-batch',
    siteHost: 'deeplearning.ai',
    listingPathPrefix: '/the-batch',
    articlePathPrefix: '/the-batch/',
    excludedPathPrefixes: ['/the-batch/about', '/the-batch/tag', '/the-batch/author'],
  },
];

function normalizeHtmlListingUrl(url: string) {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString();
}


export function findProfileForUrl(input: string | null | undefined) {
  if (!input) return null;
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return HTML_LISTING_PROFILES.find((profile) => (
      host === profile.siteHost
      && (path === profile.listingPathPrefix || path.startsWith(`${profile.listingPathPrefix}/`))
    )) ?? null;
  } catch {
    return null;
  }
}


export function resolveHtmlArticleListingEndpoint(input: {
  siteUrl?: string | null;
  url?: string | null;
}) {
  const siteCandidate = input.siteUrl ? findProfileForUrl(input.siteUrl) : null;
  if (siteCandidate && input.siteUrl) {
    return normalizeHtmlListingUrl(input.siteUrl);
  }

  const urlCandidate = input.url ? findProfileForUrl(input.url) : null;
  if (urlCandidate && input.url) {
    return normalizeHtmlListingUrl(input.url);
  }

  return null;
}
