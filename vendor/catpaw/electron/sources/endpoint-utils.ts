import type { ProviderClass } from '../contracts/reader';

export function getEndpointHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function inferEndpointProviderType(input: {
  sourceType?: string | null;
  url: string;
}) {
  if (input.sourceType && input.sourceType !== 'unknown') {
    return input.sourceType;
  }

  const host = getEndpointHost(input.url) ?? '';
  if (host.includes('wechat2rss')) return 'wechat2rss';
  if (host.includes('rsshub')) return 'rsshub-other';
  if (host.includes('xgo')) return 'xgo';
  if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube-native';
  if (host.includes('xyzfm') || host.includes('xiaoyuzhou')) return 'xiaoyuzhou-native';
  return 'native-rss';
}

export function buildEndpointCapabilitiesJson(input: {
  providerType: string;
  contentType?: string | null;
}) {
  const capabilities = {
    listing: true,
    media: input.contentType === 'podcast' || input.contentType === 'video',
    fullContent:
      input.providerType === 'wechat2rss'
      || input.providerType.startsWith('rsshub')
      || input.providerType === 'xgo'
      || input.providerType === 'html-article-listing'
      || input.providerType === 'x-api-twitter'
      || input.providerType === 'web-cli-twitter',
    images:
      input.providerType === 'wechat2rss'
      || input.providerType === 'xgo'
      || input.providerType === 'html-article-listing'
      || input.providerType === 'x-api-twitter'
      || input.providerType === 'web-cli-twitter',
  };
  return JSON.stringify(capabilities);
}

export function isRetryableFeedRunError(error: string | null | undefined) {
  if (!error) return false;
  const normalized = error.toLowerCase();
  if (
    normalized.includes('http 400')
    || normalized.includes('http 401')
    || normalized.includes('http 403')
    || normalized.includes('http 404')
    || normalized.includes('http 410')
    || normalized.includes('http 422')
    || normalized.includes('feed_not_found')
    || normalized.includes('feed_parse_failed')
  ) {
    return false;
  }
  return (
    normalized.includes('timeout')
    || normalized.includes('host_cooldown')
    || normalized.includes('timed out')
    || normalized.includes('fetch failed')
    || normalized.includes('network')
    || normalized.includes('socket')
    || normalized.includes('econn')
    || normalized.includes('http 408')
    || normalized.includes('http 429')
    || normalized.includes('http 500')
    || normalized.includes('http 502')
    || normalized.includes('http 503')
    || normalized.includes('http 504')
  );
}

// Listing scrapers render a single page and have no cursor to walk backwards; the
// X API endpoint is capped to recent tweets. A backfill through any of them is just
// a refresh, so callers must not report it as history coverage.
const HISTORY_INCAPABLE_PROVIDER_TYPES = new Set([
  'html-article-listing',
  'wechat-native-listing',
  'x-api-twitter',
]);

export function canPageIntoHistory(providerType: string | null | undefined) {
  if (!providerType) return true;
  return !HISTORY_INCAPABLE_PROVIDER_TYPES.has(providerType);
}

export function getEndpointFailurePolicy(providerType: string | null | undefined) {
  const providerClass = getProviderClass(providerType);
  if (providerClass === 'bridge') {
    return {
      failureThreshold: 5,
      cooldownMs: 5 * 60 * 1000,
    };
  }
  return {
    failureThreshold: 3,
    cooldownMs: 15 * 60 * 1000,
  };
}

export function getProviderClass(providerType: string | null | undefined): ProviderClass {
  if (!providerType) return 'unknown';
  if (
    providerType === 'native-rss'
    || providerType === 'youtube-native'
    || providerType === 'xiaoyuzhou-native'
  ) {
    return 'native';
  }
  if (
    providerType === 'wechat2rss'
    || providerType === 'xgo'
    || providerType.startsWith('rsshub')
  ) {
    return 'bridge';
  }
  return 'adapter';
}
