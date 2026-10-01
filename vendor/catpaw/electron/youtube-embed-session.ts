import type {
  OnBeforeSendHeadersListenerDetails,
  WebRequest,
  WebRequestFilter,
} from 'electron';
import { CATPAW_APP_ID } from './app-identity';

export const YOUTUBE_EMBED_APP_REFERRER = `https://${CATPAW_APP_ID}/`;

export const YOUTUBE_EMBED_HOST_SUFFIXES = [
  'youtube.com',
  'youtube-nocookie.com',
] as const;

const YOUTUBE_EMBED_REQUEST_FILTER: WebRequestFilter = {
  urls: [
    'https://youtube.com/*',
    'https://*.youtube.com/*',
    'https://youtube-nocookie.com/*',
    'https://*.youtube-nocookie.com/*',
  ],
  types: ['subFrame'],
};

type YoutubeEmbedRequestDetails = Pick<
  OnBeforeSendHeadersListenerDetails,
  'url' | 'resourceType' | 'webContentsId' | 'requestHeaders'
>;

type YoutubeEmbedWebRequest = Pick<WebRequest, 'onBeforeSendHeaders'>;

function matchesHostSuffix(hostname: string, suffix: string) {
  const host = hostname.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function isYoutubeEmbedHost(hostname: string) {
  return YOUTUBE_EMBED_HOST_SUFFIXES.some((suffix) => (
    matchesHostSuffix(hostname, suffix)
  ));
}

export function isYoutubeEmbedPlayerUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || !isYoutubeEmbedHost(parsed.hostname)) {
      return false;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[0]?.toLowerCase() === 'embed' && Boolean(segments[1]);
  } catch {
    return false;
  }
}

function withHeader(
  requestHeaders: Record<string, string>,
  name: string,
  value: string,
) {
  const nextHeaders = { ...requestHeaders };
  for (const existingName of Object.keys(nextHeaders)) {
    if (existingName.toLowerCase() === name.toLowerCase()) {
      delete nextHeaders[existingName];
    }
  }
  nextHeaders[name] = value;
  return nextHeaders;
}

export function buildYoutubeEmbedRequestHeaders(
  details: YoutubeEmbedRequestDetails,
  allowedWebContentsId: number | null,
) {
  const isAllowedRequest = allowedWebContentsId !== null
    && details.webContentsId === allowedWebContentsId
    && details.resourceType === 'subFrame'
    && isYoutubeEmbedPlayerUrl(details.url);

  if (!isAllowedRequest) return null;

  // YouTube error 153 means the desktop/WebView embed did not provide an
  // HTTP Referer (or equivalent API-client identity). A local file:// page
  // has no usable HTTPS origin, so attach Catpaw's fixed bundle identity only
  // to the initial YouTube player-frame navigation.
  return withHeader(
    details.requestHeaders,
    'Referer',
    YOUTUBE_EMBED_APP_REFERRER,
  );
}

export function installYoutubeEmbedSessionIdentity(
  webRequest: YoutubeEmbedWebRequest,
  options: {
    getAllowedWebContentsId: () => number | null;
  },
) {
  webRequest.onBeforeSendHeaders(
    YOUTUBE_EMBED_REQUEST_FILTER,
    (details, callback) => {
      const requestHeaders = buildYoutubeEmbedRequestHeaders(
        details,
        options.getAllowedWebContentsId(),
      );
      callback(requestHeaders ? { requestHeaders } : {});
    },
  );
}
