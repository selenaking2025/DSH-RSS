const WEB_CLI_ENDPOINT_PROTOCOL = 'web-cli-twitter:';
const WEB_CLI_ENDPOINT_HOST = 'twitter';
const WEB_CLI_ENDPOINT_PATH = 'user';
export const X_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com']);
const OPENRSS_HOSTS = new Set(['openrss.org', 'www.openrss.org']);
const RSSHUB_HOST_HINTS = ['rsshub', 'bestblogs.dev'];

export function normalizeTwitterHandle(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim().replace(/^@+/, '');
  if (!trimmed) return null;
  return /^[A-Za-z0-9_]{1,15}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function extractTwitterHandleFromXUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (!X_HOSTS.has(host)) return null;
    return normalizeTwitterHandle(parsed.pathname.split('/').filter(Boolean)[0] ?? '');
  } catch {
    return null;
  }
}

function extractTwitterHandleFromOpenRssUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (!OPENRSS_HOSTS.has(host)) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if ((segments[0]?.toLowerCase() === 'twitter.com' || segments[0]?.toLowerCase() === 'x.com') && segments[1]) {
      return normalizeTwitterHandle(segments[1]);
    }
    return null;
  } catch {
    return null;
  }
}

function extractTwitterHandleFromRsshubUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (!RSSHUB_HOST_HINTS.some((candidate) => host.includes(candidate))) {
      return null;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0]?.toLowerCase() === 'twitter' && segments[1]?.toLowerCase() === 'user' && segments[2]) {
      return normalizeTwitterHandle(decodeURIComponent(segments[2]));
    }
    return null;
  } catch {
    return null;
  }
}

function extractTwitterHandleFromWebCliEndpointUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== WEB_CLI_ENDPOINT_PROTOCOL || parsed.hostname.toLowerCase() !== WEB_CLI_ENDPOINT_HOST) {
      return null;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0]?.toLowerCase() !== WEB_CLI_ENDPOINT_PATH || !segments[1]) {
      return null;
    }
    return normalizeTwitterHandle(decodeURIComponent(segments[1]));
  } catch {
    return null;
  }
}

export function resolveWebCliTwitterHandle(input: {
  endpointUrl?: string | null;
  siteUrl?: string | null;
  url?: string | null;
}) {
  return (
    extractTwitterHandleFromWebCliEndpointUrl(input.endpointUrl ?? '')
    || extractTwitterHandleFromXUrl(input.siteUrl ?? '')
    || extractTwitterHandleFromXUrl(input.url ?? '')
    || extractTwitterHandleFromOpenRssUrl(input.url ?? '')
    || extractTwitterHandleFromRsshubUrl(input.url ?? '')
    || null
  );
}

export function buildWebCliTwitterEndpointUrl(handle: string) {
  return `${WEB_CLI_ENDPOINT_PROTOCOL}//${WEB_CLI_ENDPOINT_HOST}/${WEB_CLI_ENDPOINT_PATH}/${encodeURIComponent(handle)}`;
}
