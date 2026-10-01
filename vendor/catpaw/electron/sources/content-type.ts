export type FeedContentType = 'blog' | 'video' | 'podcast' | 'social';
export type FeedSourceType =
  | 'xgo'
  | 'wechat2rss'
  | 'rsshub-xiaoyuzhou'
  | 'rsshub-wechat'
  | 'rsshub-other'
  | 'youtube-rss'
  | 'native-rss'
  | 'unknown';
export type EntryMediaType = 'video' | 'audio' | 'image';

type MediaCandidate = {
  url?: string;
  type?: string;
  medium?: string;
};

function readCandidateField(source: Record<string, unknown>, key: string) {
  const direct = source[key];
  if (typeof direct === 'string') return direct;
  const attrs = source.$ as Record<string, unknown> | undefined;
  if (!attrs) return null;
  const nested = attrs[key];
  return typeof nested === 'string' ? nested : null;
}

function normalizeCandidate(value: unknown): MediaCandidate | null {
  if (!value) return null;
  if (typeof value === 'string') {
    return { url: value };
  }
  if (typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const url = readCandidateField(source, 'url') ?? readCandidateField(source, 'href');
  const type = readCandidateField(source, 'type');
  const medium = readCandidateField(source, 'medium');
  if (!url && !type && !medium) return null;
  return {
    url: url ?? undefined,
    type: type ?? undefined,
    medium: medium ?? undefined,
  };
}

function isXiaoyuzhouEpisodeLink(link: string | null) {
  if (!link) return false;
  try {
    const parsed = new URL(link);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host.includes('xiaoyuzhoufm.com') && parsed.pathname.toLowerCase().includes('/episode/');
  } catch {
    return false;
  }
}

export function detectFeedContentType(feedUrl: string, siteUrl: string | null): FeedContentType {
  const url = siteUrl ?? feedUrl;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'blog';
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

  // Video platforms
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'video';
  if (host.includes('bilibili.com')) return 'video';
  if (host.includes('vimeo.com')) return 'video';

  // Social platforms
  if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') return 'social';
  if (host.endsWith('weibo.com')) return 'social';

  // Podcast platforms
  if (host.includes('xiaoyuzhoufm.com')) return 'podcast';
  if (host.includes('podcasts.apple.com')) return 'podcast';

  // RSSHub path patterns
  if (host.includes('rsshub')) {
    const path = parsed.pathname.toLowerCase();
    if (path.startsWith('/twitter/') || path.startsWith('/weibo/')) return 'social';
    if (path.startsWith('/youtube/') || path.startsWith('/bilibili/')) return 'video';
    if (path.startsWith('/xiaoyuzhou/')) return 'podcast';
  }

  return 'blog';
}

export function detectFeedSourceType(feedUrl: string, siteUrl: string | null): FeedSourceType {
  const target = feedUrl || siteUrl || '';
  let parsed: URL | null = null;
  try {
    parsed = new URL(target);
  } catch {
    return 'unknown';
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const sourceHost = (() => {
    if (!siteUrl) return '';
    try {
      return new URL(siteUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return '';
    }
  })();

  if (host === 'api.xgo.ing') return 'xgo';
  if (host.includes('wechat2rss')) return 'wechat2rss';
  if (host.includes('youtube.com') || host === 'youtu.be' || path.includes('/feeds/videos.xml')) return 'youtube-rss';

  if (host.includes('rsshub') || host.includes('bestblogs.dev')) {
    if (path.startsWith('/xiaoyuzhou/')) return 'rsshub-xiaoyuzhou';
    if (path.startsWith('/wechat/')) return 'rsshub-wechat';
    return 'rsshub-other';
  }

  if (sourceHost.includes('rsshub') || sourceHost.includes('bestblogs.dev')) {
    if (sourceHost.includes('wechat2rss')) return 'wechat2rss';
    return 'rsshub-other';
  }

  if (path.endsWith('.xml') || path.endsWith('.rss') || path.endsWith('.atom') || path.includes('/feed')) {
    return 'native-rss';
  }

  return 'unknown';
}

export function detectEntryMediaType(item: {
  enclosure?: { url?: string; type?: string } | string | Record<string, unknown>;
  mediaContents?: Array<{ url?: string; type?: string; medium?: string } | string | Record<string, unknown>>;
  link?: string | null;
}): { mediaUrl: string | null; mediaType: EntryMediaType | null } {
  // 1. Check enclosure + media:content
  const candidates: MediaCandidate[] = [];
  const enclosureCandidate = normalizeCandidate(item.enclosure);
  if (enclosureCandidate?.url || enclosureCandidate?.type || enclosureCandidate?.medium) {
    candidates.push(enclosureCandidate);
  }
  for (const media of item.mediaContents ?? []) {
    const candidate = normalizeCandidate(media);
    if (!candidate?.url && !candidate?.type && !candidate?.medium) continue;
    candidates.push(candidate);
  }

  for (const candidate of candidates) {
    const mediaType = detectMediaTypeFromCandidate(candidate);
    if (mediaType) {
      return { mediaUrl: candidate.url ?? null, mediaType };
    }
  }

  // Xiaoyuzhou items may carry enclosure URL without MIME/ext; treat as audio.
  if (isXiaoyuzhouEpisodeLink(item.link ?? null)) {
    const candidate = candidates.find((value) => Boolean(value.url));
    if (candidate?.url) {
      return { mediaUrl: candidate.url, mediaType: 'audio' };
    }
  }

  // 2. Extract video embed URL from entry link
  const videoEmbed = extractVideoEmbedUrl(item.link ?? null);
  if (videoEmbed) {
    return { mediaUrl: videoEmbed, mediaType: 'video' };
  }

  // 3. Check if entry link itself is a direct media URL
  const linkMediaType = detectMediaTypeFromUrl(item.link ?? null);
  if (linkMediaType && item.link) {
    return { mediaUrl: item.link, mediaType: linkMediaType };
  }

  return { mediaUrl: null, mediaType: null };
}

export function extractVideoEmbedUrl(link: string | null): string | null {
  if (!link) return null;
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

  // YouTube
  const isYouTubeHost =
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com');

  if (isYouTubeHost) {
    let videoId: string | null = null;
    if (host === 'youtu.be') {
      videoId = parsed.pathname.slice(1).split('/')[0] || null;
    } else if (parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v');
    } else if (parsed.pathname.startsWith('/shorts/')) {
      videoId = parsed.pathname.split('/')[2] || null;
    } else if (parsed.pathname.startsWith('/embed/')) {
      videoId = parsed.pathname.split('/')[2] || null;
    }
    if (videoId) {
      return `https://www.youtube.com/embed/${videoId}`;
    }
  }

  // Bilibili
  if (host.includes('bilibili.com')) {
    const match = parsed.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
    if (match) {
      return `https://player.bilibili.com/player.html?bvid=${match[1]}&autoplay=0`;
    }
  }

  // Vimeo
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
    const match = parsed.pathname.match(/^\/(\d+)/);
    if (match) {
      return `https://player.vimeo.com/video/${match[1]}`;
    }
  }

  return null;
}

function detectMediaTypeFromCandidate(candidate: MediaCandidate): EntryMediaType | null {
  const fromMime = detectMediaTypeFromMime(candidate.type ?? null);
  if (fromMime) return fromMime;

  const fromMedium = detectMediaTypeFromMedium(candidate.medium ?? null);
  if (fromMedium) return fromMedium;

  return detectMediaTypeFromUrl(candidate.url ?? null);
}

function detectMediaTypeFromMime(type: string | null): EntryMediaType | null {
  if (!type) return null;
  const normalized = type.toLowerCase();
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.startsWith('image/')) return 'image';
  return null;
}

function detectMediaTypeFromMedium(medium: string | null): EntryMediaType | null {
  if (!medium) return null;
  const normalized = medium.toLowerCase();
  if (normalized === 'video') return 'video';
  if (normalized === 'audio') return 'audio';
  if (normalized === 'image') return 'image';
  return null;
}

function detectMediaTypeFromUrl(url: string | null): EntryMediaType | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const path = parsed.pathname.toLowerCase();
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(path)) return 'video';
  if (/\.(mp3|aac|m4a|ogg|opus|wav|flac)$/.test(path)) return 'audio';
  if (/\.(jpg|jpeg|png|gif|webp|avif)$/.test(path)) return 'image';
  return null;
}
