import { HIDDEN_GROUP_ACTION_NAMES, HOME_FEED_TITLE_HINT } from './constants';
import type { PrimaryGroupName } from './constants';
import type { Entry, Feed, MediaChapter } from './types';

const zhCollator = new Intl.Collator('zh-Hans-u-co-pinyin', { numeric: true, sensitivity: 'base' });
const enCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const ALLOWED_IFRAME_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'player.bilibili.com',
  'player.vimeo.com',
  'platform.twitter.com',
]);

function hasCjk(text: string) {
  return /[\u4e00-\u9fff]/.test(text);
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * List-row timestamp. Recent items show a time or weekday so a glance tells you
 * how fresh the item is; older items fall back to an absolute date.
 */
export function formatEntryTimestamp(value: number | null | undefined, now = Date.now()): string {
  if (value === null || value === undefined) return '';
  const published = new Date(value);
  if (Number.isNaN(published.getTime())) return '';

  const today = startOfDay(now);
  const dayDelta = Math.round((today - startOfDay(published.getTime())) / 86_400_000);

  if (dayDelta <= 0) {
    return `${String(published.getHours()).padStart(2, '0')}:${String(published.getMinutes()).padStart(2, '0')}`;
  }
  if (dayDelta === 1) return '昨天';
  if (dayDelta < 7) return WEEKDAY_LABELS[published.getDay()];
  if (published.getFullYear() === new Date(now).getFullYear()) {
    return `${published.getMonth() + 1}月${published.getDate()}日`;
  }
  return `${published.getFullYear()}年${published.getMonth() + 1}月${published.getDate()}日`;
}

/** Absolute timestamp for the article header, where precision matters. */
export function formatEntryDateTime(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const published = new Date(value);
  if (Number.isNaN(published.getTime())) return '';
  const time = `${String(published.getHours()).padStart(2, '0')}:${String(published.getMinutes()).padStart(2, '0')}`;
  return `${published.getFullYear()}年${published.getMonth() + 1}月${published.getDate()}日 ${time}`;
}

export function compareLabels(a: string, b: string) {
  const aHas = hasCjk(a);
  const bHas = hasCjk(b);
  if (aHas !== bHas) return aHas ? -1 : 1;
  if (aHas) return zhCollator.compare(a, b);
  return enCollator.compare(a, b);
}

export function inferPrimaryGroupName(input: { url: string; title: string }): PrimaryGroupName {
  const normalizedUrl = input.url.trim();
  const normalizedTitle = input.title.trim();
  const sourceText = `${normalizedUrl} ${normalizedTitle}`.toLowerCase();
  let host = '';
  try {
    host = new URL(normalizedUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    host = '';
  }

  const paperHosts = [
    'arxiv.org',
    'openreview.net',
    'aclanthology.org',
    'paperswithcode.com',
    'semanticscholar.org',
    'huggingface.co',
  ];
  const financeHosts = [
    'bloomberg.com',
    'reuters.com',
    'wsj.com',
    'ft.com',
    'cnbc.com',
    'finance.yahoo.com',
    'caixin.com',
    'yicai.com',
  ];
  const paperKeywords = [
    'arxiv',
    'openreview',
    'paper',
    '论文',
    '预印本',
    'research',
    'iclr',
    'neurips',
    'cvpr',
    'acl',
    'emnlp',
    'aaai',
    'ijcai',
  ];
  const financeKeywords = [
    'finance',
    'market',
    'economy',
    'stock',
    'bond',
    '财经',
    '经济',
    '金融',
    '股市',
    '证券',
    '投资',
    '资本',
    '宏观',
  ];

  if (paperHosts.some((keyword) => host.includes(keyword)) || paperKeywords.some((keyword) => sourceText.includes(keyword))) {
    return 'AI论文';
  }
  if (financeHosts.some((keyword) => host.includes(keyword)) || financeKeywords.some((keyword) => sourceText.includes(keyword))) {
    return '财经资讯';
  }
  return 'AI资讯';
}

export function getInitial(label: string) {
  const trimmed = label.trim();
  if (!trimmed) return '?';
  return trimmed[0].toUpperCase();
}

export function getFallbackColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 35%, 82%)`;
}

function isPreferredHomeFeed(feed: Feed) {
  const haystack = `${feed.title ?? ''} ${feed.url ?? ''} ${feed.siteUrl ?? ''}`.toLowerCase();
  return haystack.includes(HOME_FEED_TITLE_HINT.toLowerCase());
}

export function pickInitialFeedId(feeds: Feed[], currentFeedId: string | null) {
  if (currentFeedId && feeds.some((feed) => feed.id === currentFeedId)) {
    return currentFeedId;
  }
  const preferredFeed = feeds.find((feed) => isPreferredHomeFeed(feed));
  return preferredFeed?.id ?? feeds[0]?.id ?? null;
}

export function shouldHideGroupActions(groupName: string) {
  return HIDDEN_GROUP_ACTION_NAMES.has(groupName);
}

export function getEntryContentLength(entry: {
  contentLength?: number | null;
  contentText?: string | null;
  contentHtml?: string | null;
}) {
  if (typeof entry.contentLength === 'number') return entry.contentLength;
  if (typeof entry.contentText === 'string') return entry.contentText.length;
  if (typeof entry.contentHtml === 'string') {
    return entry.contentHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length;
  }
  return 0;
}

export function toEntryPreview(entry: any): Entry {
  return {
    id: entry.id,
    feedId: entry.feedId,
    title: entry.title ?? null,
    link: entry.link ?? null,
    summary: entry.summary ?? null,
    contentHtml: entry.contentHtml ?? null,
    contentText: entry.contentText ?? null,
    publishedAt: entry.publishedAt ?? null,
    isRead: entry.isRead ?? 0,
    isStarred: entry.isStarred ?? 0,
    mediaUrl: entry.mediaUrl ?? null,
    mediaType: entry.mediaType ?? null,
    contentLength: getEntryContentLength(entry),
    contentFetchStatus: entry.contentFetchStatus ?? null,
    contentFetchedAt: entry.contentFetchedAt ?? null,
    contentFetchAttemptedAt: entry.contentFetchAttemptedAt ?? null,
    contentFetchError: entry.contentFetchError ?? null,
  };
}

export function getFeedIconUrl(feed: Feed) {
  const source = feed.siteUrl ?? feed.url;
  if (!source) return null;
  try {
    const parsed = new URL(source);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host.includes('rsshub') || host.includes('wechat2rss')) return null;
    return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(parsed.origin)}`;
  } catch {
    return null;
  }
}

export function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function isAllowedIframeSrc(src: string): boolean {
  try {
    const parsed = new URL(src);
    return ALLOWED_IFRAME_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function buildVideoEmbed(mediaUrl: string, startAtSeconds?: number | null): string | null {
  try {
    const embeddableUrl = resolveVideoEmbedFromLink(mediaUrl) ?? mediaUrl;
    const parsed = new URL(embeddableUrl);
    const host = parsed.hostname.toLowerCase();
    const startAt = startAtSeconds && startAtSeconds > 0 ? Math.floor(startAtSeconds) : 0;
    const embedUrl = new URL(embeddableUrl);
    const suffixMatch = (candidate: string, suffix: string) => (
      candidate === suffix || candidate.endsWith(`.${suffix}`)
    );
    if (suffixMatch(host, 'youtube.com') || suffixMatch(host, 'youtube-nocookie.com')) {
      if (startAt > 0) {
        embedUrl.searchParams.set('start', String(startAt));
      }
      return `<div class="video-container"><iframe src="${embedUrl.toString()}" frameborder="0" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    }
    if (host.includes('bilibili.com')) {
      if (startAt > 0) {
        embedUrl.searchParams.set('t', String(startAt));
      }
      return `<div class="video-container"><iframe src="${embedUrl.toString()}" frameborder="0" allowfullscreen scrolling="no"></iframe></div>`;
    }
    if (host.includes('vimeo.com')) {
      if (startAt > 0) {
        embedUrl.hash = `t=${startAt}s`;
      }
      return `<div class="video-container"><iframe src="${embedUrl.toString()}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
    }
  } catch {
    // Fall through.
  }
  return null;
}

export function resolveVideoEmbedFromLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const parsed = new URL(link);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0];
      if (id) return `https://www.youtube.com/embed/${id}`;
    }

    if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
      let id: string | null = null;
      if (parsed.pathname === '/watch') {
        id = parsed.searchParams.get('v');
      } else if (parsed.pathname.startsWith('/shorts/')) {
        id = parsed.pathname.split('/')[2] || null;
      } else if (parsed.pathname.startsWith('/embed/')) {
        id = parsed.pathname.split('/')[2] || null;
      }
      const embedHost = host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')
        ? 'www.youtube-nocookie.com'
        : 'www.youtube.com';
      if (id) return `https://${embedHost}/embed/${id}`;
    }

    if (host.includes('bilibili.com')) {
      const match = parsed.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
      if (match) return `https://player.bilibili.com/player.html?bvid=${match[1]}&autoplay=0`;
    }

    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
      const match = parsed.pathname.match(/^\/(\d+)/);
      if (match) return `https://player.vimeo.com/video/${match[1]}`;
    }
  } catch {
    return null;
  }
  return null;
}

function extractTweetId(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/(?:twitter\.com|x\.com)\/(?:i\/web\/status|[A-Za-z0-9_]+\/status)\/(\d+)/i);
  return match ? match[1] : null;
}

function extractTweetIdFromText(source: string | null | undefined): string | null {
  if (!source) return null;
  const match = source.match(/(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/(?:i\/web\/status|[A-Za-z0-9_]+\/status)\/(\d+)/i);
  return match ? match[1] : null;
}

export function resolveEntryTweetId(entry: {
  link?: string | null;
  contentHtml?: string | null;
  summary?: string | null;
  contentText?: string | null;
} | null | undefined): string | null {
  if (!entry) return null;
  return (
    extractTweetId(entry.link ?? null) ||
    extractTweetIdFromText(entry.contentHtml ?? null) ||
    extractTweetIdFromText(entry.summary ?? null) ||
    extractTweetIdFromText(entry.contentText ?? null)
  );
}

export function buildTweetEmbedUrl(tweetId: string) {
  const embedUrl = new URL('https://platform.twitter.com/embed/Tweet.html');
  embedUrl.searchParams.set('id', tweetId);
  embedUrl.searchParams.set('theme', 'light');
  embedUrl.searchParams.set('dnt', 'true');
  return embedUrl.toString();
}

export function getUrlHostLabel(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function parseTimecodeToSeconds(input: string) {
  const parts = input.trim().split(':').map((part) => Number(part));
  if (!parts.length || parts.some((part) => Number.isNaN(part) || part < 0)) return null;
  if (parts.length === 2) {
    const [m, s] = parts;
    if (s >= 60) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (m >= 60 || s >= 60) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

function htmlToChapterText(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractChaptersFromEntry(entry: any): MediaChapter[] {
  if (!entry) return [];
  const candidateText = [
    htmlToChapterText(entry.contentHtml ?? null),
    entry.contentText ?? '',
    entry.summary ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  if (!candidateText.trim()) return [];

  const chapterPattern = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[-–—|:：]\s*|\s+)(.{2,140})\s*$/;
  const seenBySecond = new Map<number, MediaChapter>();
  const lines = candidateText.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(chapterPattern);
    if (!match) continue;
    const seconds = parseTimecodeToSeconds(match[1]);
    if (seconds === null) continue;
    if (seenBySecond.has(seconds)) continue;
    seenBySecond.set(seconds, {
      timecode: match[1],
      seconds,
      label: match[2].trim(),
    });
  }

  if (seenBySecond.size === 0) {
    const inlinePattern = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[-–—|:：]\s*|\s+)([^。！？.!?\n]{3,120})/g;
    let match: RegExpExecArray | null = null;
    while ((match = inlinePattern.exec(candidateText)) !== null) {
      const seconds = parseTimecodeToSeconds(match[1]);
      if (seconds === null || seenBySecond.has(seconds)) continue;
      seenBySecond.set(seconds, {
        timecode: match[1],
        seconds,
        label: match[2].trim(),
      });
    }
  }

  return Array.from(seenBySecond.values())
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, 24);
}
