const RSSHUB_BASE_URL = (process.env.CATPAW_RSSHUB_BASE_URL || 'https://rsshub.app').replace(/\/+$/, '');
const XIAOYUZHOU_FEED_BASE_URL = 'https://feed.xyzfm.space';
const YOUTUBE_FEED_BASE_URL = 'https://www.youtube.com/feeds/videos.xml';
const OPENRSS_BASE_URL = 'https://openrss.org';

function isLikelyXiaoyuzhouPodcastId(value: string) {
  return /^[A-Za-z0-9]{12,64}$/.test(value);
}

function isXiaoyuzhouSiteUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host.includes('xiaoyuzhoufm.com');
  } catch {
    return false;
  }
}

function buildXiaoyuzhouOfficialFeedUrl(podcastId: string) {
  return `${XIAOYUZHOU_FEED_BASE_URL}/${podcastId}.xml`;
}

function buildYouTubeNativeFeedUrl(channelId: string) {
  return `${YOUTUBE_FEED_BASE_URL}?channel_id=${encodeURIComponent(channelId)}`;
}

function extractYouTubeChannelId(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (host.includes('youtube.com') || host === 'youtu.be') {
    if (segments[0]?.toLowerCase() === 'feeds' && segments[1]?.toLowerCase() === 'videos.xml') {
      const channelId = parsed.searchParams.get('channel_id');
      return channelId && /^UC[\w-]{10,}$/.test(channelId) ? channelId : null;
    }
    if (segments[0]?.toLowerCase() === 'channel' && segments[1] && /^UC[\w-]{10,}$/.test(segments[1])) {
      return segments[1];
    }
  }

  if ((host.includes('rsshub') || host.includes('bestblogs.dev')) && segments[0]?.toLowerCase() === 'youtube') {
    if (segments[1]?.toLowerCase() === 'channel' && segments[2] && /^UC[\w-]{10,}$/.test(segments[2])) {
      return segments[2];
    }
  }

  return null;
}

function extractXiaoyuzhouPodcastId(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (host.includes('xiaoyuzhoufm.com')) {
    const podcastIndex = segments.findIndex((seg) => seg.toLowerCase() === 'podcast');
    if (podcastIndex >= 0 && segments[podcastIndex + 1] && isLikelyXiaoyuzhouPodcastId(segments[podcastIndex + 1])) {
      return segments[podcastIndex + 1];
    }
  }

  if (host.includes('rsshub') || host.includes('bestblogs.dev')) {
    if (
      segments[0]?.toLowerCase() === 'xiaoyuzhou' &&
      segments[1]?.toLowerCase() === 'podcast' &&
      segments[2] &&
      isLikelyXiaoyuzhouPodcastId(segments[2])
    ) {
      return segments[2];
    }
  }

  if (host === 'feed.xyzfm.space' && segments[0]) {
    const maybeId = segments[0].replace(/\.xml$/i, '');
    if (isLikelyXiaoyuzhouPodcastId(maybeId)) return maybeId;
  }

  return null;
}

export function extractXiaoyuzhouPodcastIdFromUrl(url: string | null | undefined) {
  return extractXiaoyuzhouPodcastId(url);
}

export function resolvePreferredFetchUrl(feedUrl: string, siteUrl?: string | null) {
  const podcastId = extractXiaoyuzhouPodcastId(feedUrl) ?? extractXiaoyuzhouPodcastId(siteUrl ?? null);
  if (podcastId) {
    return buildXiaoyuzhouOfficialFeedUrl(podcastId);
  }
  const youtubeChannelId = extractYouTubeChannelId(feedUrl) ?? extractYouTubeChannelId(siteUrl ?? null);
  if (youtubeChannelId) {
    return buildYouTubeNativeFeedUrl(youtubeChannelId);
  }
  return feedUrl;
}

function isXgoFeedUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase() === 'api.xgo.ing';
  } catch {
    return false;
  }
}

function isRsshubXiaoyuzhouFeedUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const segments = parsed.pathname.split('/').filter(Boolean);
    const isRsshubHost = host.includes('rsshub') || host.includes('bestblogs.dev');
    return isRsshubHost && segments[0]?.toLowerCase() === 'xiaoyuzhou' && segments[1]?.toLowerCase() === 'podcast';
  } catch {
    return false;
  }
}

export function isWeChat2RssFeedUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host.includes('wechat2rss');
  } catch {
    return false;
  }
}

function normalizeUrl(input?: string | null): string | null {
  if (!input) return null;
  const value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(value)) return `https://${value}`;
  return null;
}

function isLikelyFeedUrl(url: string) {
  const lowered = url.toLowerCase();
  if (lowered.endsWith('.xml') || lowered.endsWith('.rss') || lowered.endsWith('.atom') || lowered.endsWith('.rdf')) {
    return true;
  }
  if (lowered.includes('/feed') || lowered.includes('format=rss') || lowered.includes('format=atom')) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host.includes('rsshub') || host.includes('wechat2rss')) return true;
  } catch (error) {
    return false;
  }
  return false;
}

function buildRsshub(path: string, baseUrl = RSSHUB_BASE_URL) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function buildOpenRssUrl(url: string, baseUrl = OPENRSS_BASE_URL) {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedTarget = url.replace(/^https?:\/\//i, '').replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedTarget}`;
}

export function inferRsshubBaseFromFeedUrl(feedUrl: string): string | null {
  try {
    const parsed = new URL(feedUrl);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const origin = `${parsed.protocol}//${parsed.host}`;

    if (host.startsWith('rsshub.')) {
      return origin.replace(/\/+$/, '');
    }

    if (host.startsWith('wechat2rss.')) {
      const suffix = host.slice('wechat2rss.'.length);
      return `${parsed.protocol}//rsshub.${suffix}`.replace(/\/+$/, '');
    }
  } catch {
    return null;
  }
  return null;
}

function resolveRsshubFromUrl(url: string, options?: { rsshubBase?: string | null }): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    return null;
  }
  const baseUrl = normalizeUrl(options?.rsshubBase ?? null)?.replace(/\/+$/, '') ?? RSSHUB_BASE_URL;
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);

  if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
    const username = segments[0];
    if (username && !username.startsWith('search')) {
      return buildOpenRssUrl(`twitter.com/${username}`);
    }
  }

  if (host.endsWith('weibo.com')) {
    let uid = '';
    if (segments[0] === 'u' && segments[1]) {
      uid = segments[1];
    } else if (segments[0] && /^\d+$/.test(segments[0])) {
      uid = segments[0];
    } else if (parsed.searchParams.get('uid')) {
      uid = parsed.searchParams.get('uid') || '';
    }
    if (uid) {
      return buildRsshub(`weibo/user/${uid}`, baseUrl);
    }
  }

  if (host === 'mp.weixin.qq.com') {
    const biz = parsed.searchParams.get('__biz');
    if (biz) {
      return buildRsshub(`wechat/mp/${biz}`, baseUrl);
    }
  }

  // YouTube channel / @handle
  if (host === 'youtube.com' || host === 'youtu.be') {
    if (segments[0] === 'channel' && segments[1]) {
      return buildRsshub(`youtube/channel/${segments[1]}`, baseUrl);
    }
    if (segments[0] && segments[0].startsWith('@')) {
      return buildRsshub(`youtube/user/${segments[0]}`, baseUrl);
    }
    if (segments[0] === 'user' && segments[1]) {
      return buildRsshub(`youtube/user/${segments[1]}`, baseUrl);
    }
  }

  // Bilibili user space
  if (host.includes('bilibili.com')) {
    let uid: string | null = null;

    if (host === 'space.bilibili.com' && segments[0] && /^\d+$/.test(segments[0])) {
      uid = segments[0];
    }
    if (!uid && segments[0] === 'space' && segments[1] && /^\d+$/.test(segments[1])) {
      uid = segments[1];
    }
    if (!uid) {
      const mid = parsed.searchParams.get('mid');
      if (mid && /^\d+$/.test(mid)) {
        uid = mid;
      }
    }

    if (uid) {
      return buildRsshub(`bilibili/user/video/${uid}`, baseUrl);
    }
  }

  if (host.includes('xiaoyuzhoufm.com')) {
    const podcastId = extractXiaoyuzhouPodcastId(url);
    if (podcastId) {
      return buildXiaoyuzhouOfficialFeedUrl(podcastId);
    }
  }

  return null;
}

export function resolveBackfillFetchUrl(feedUrl: string, siteUrl?: string | null) {
  const normalizedSiteUrl = normalizeUrl(siteUrl ?? null);
  const rsshubBase = inferRsshubBaseFromFeedUrl(feedUrl);

  // RSSHub Xiaoyuzhou route may provide deeper archive traversal than the
  // official feed endpoint used for regular refresh.
  if (isRsshubXiaoyuzhouFeedUrl(feedUrl)) {
    return feedUrl;
  }

  if (isWeChat2RssFeedUrl(feedUrl) && normalizedSiteUrl) {
    const rsshubUrl = resolveRsshubFromUrl(normalizedSiteUrl, { rsshubBase });
    if (rsshubUrl) return rsshubUrl;
  }

  const preferred = resolvePreferredFetchUrl(feedUrl, siteUrl);
  if (preferred !== feedUrl) return preferred;

  if (!isXgoFeedUrl(feedUrl) || !normalizedSiteUrl) return feedUrl;

  const rsshubUrl = resolveRsshubFromUrl(normalizedSiteUrl, { rsshubBase });
  return rsshubUrl ?? feedUrl;
}

export function resolveWeChatBackfillUrlFromEntryLink(link: string | null | undefined, rsshubBase?: string | null) {
  const normalized = normalizeUrl(link ?? null);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'mp.weixin.qq.com') return null;
  } catch {
    return null;
  }
  const rsshubUrl = resolveRsshubFromUrl(normalized, { rsshubBase: rsshubBase ?? null });
  if (!rsshubUrl || !/\/wechat\/mp\//i.test(rsshubUrl)) return null;
  return rsshubUrl;
}

export function resolveFeedUrlFromInput(input: string) {
  const normalized = normalizeUrl(input);
  if (!normalized) return { url: input };
  const preferred = resolvePreferredFetchUrl(normalized, normalized);
  if (preferred !== normalized) {
    return { url: preferred, siteUrl: normalized };
  }
  if (isLikelyFeedUrl(normalized)) return { url: normalized };
  const rsshubUrl = resolveRsshubFromUrl(normalized);
  if (rsshubUrl) return { url: rsshubUrl, siteUrl: normalized };
  return { url: normalized };
}

export function resolveFeedFromOutline(input: {
  xmlUrl?: string | null;
  htmlUrl?: string | null;
  title?: string | null;
  text?: string | null;
}) {
  const xmlUrl = normalizeUrl(input.xmlUrl ?? null);
  const htmlUrl = normalizeUrl(input.htmlUrl ?? null);

  if (xmlUrl) {
    const preferredXml = resolvePreferredFetchUrl(xmlUrl, htmlUrl ?? xmlUrl);
    if (preferredXml !== xmlUrl) {
      const siteUrl = htmlUrl ?? (isXiaoyuzhouSiteUrl(xmlUrl) ? xmlUrl : null);
      return { url: preferredXml, siteUrl, title: input.title ?? null };
    }
    return { url: xmlUrl, siteUrl: htmlUrl ?? null, title: input.title ?? null };
  }

  if (!htmlUrl) return null;

  const preferredFromHtml = resolvePreferredFetchUrl(htmlUrl, htmlUrl);
  if (preferredFromHtml !== htmlUrl) {
    return { url: preferredFromHtml, siteUrl: htmlUrl, title: input.title ?? null };
  }

  if (isLikelyFeedUrl(htmlUrl)) {
    return { url: htmlUrl, siteUrl: htmlUrl, title: input.title ?? null };
  }

  const rsshubUrl = resolveRsshubFromUrl(htmlUrl);
  if (rsshubUrl) {
    return { url: rsshubUrl, siteUrl: htmlUrl, title: input.title ?? null };
  }

  return null;
}
