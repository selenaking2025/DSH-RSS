import { getFeedSyncTarget, type FeedSyncTarget } from '../data/feed-sync-repo';
import { buildXPostTitle as buildPostTitle } from '../contracts/article-title';
import fs from 'node:fs';
import path from 'node:path';
import { listFeedEntryLinks, updateFeedFetchMeta } from '../data/feed-write-repo';
import { upsertEntry } from '../data/entry-repo';
import { fetchWithTimeout } from '../network/http';
import { resolveUserDataDir } from '../runtime';

const X_API_ENDPOINT_PROTOCOL = 'x-api:';
const X_API_ENDPOINT_HOST = 'twitter';
const X_API_ENDPOINT_PATH = 'user';
const DEFAULT_X_API_POST_COUNT = 10;
const MAX_X_API_POST_COUNT = 25;
const X_API_TIMEOUT_MS = 12_000;
const X_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com']);
const OPENRSS_HOSTS = new Set(['openrss.org', 'www.openrss.org']);
const RSSHUB_HOST_HINTS = ['rsshub', 'bestblogs.dev'];
const TARGET_GROUP_NAME = 'AI X Following Batch 1';
const TARGET_PARENT_GROUP_NAME = 'AtlasNews';
const TWEET_LINK_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/(?:(?:i\/web\/status)|(?:[A-Za-z0-9_]{1,30}\/status))\/(\d+)/i;
const X_API_BEARER_TOKEN_FILE_NAME = 'x-api-bearer-token.txt';

type XApiUserLookupResponse = {
  data?: {
    id?: string;
    username?: string;
    name?: string;
  };
  errors?: Array<{
    detail?: string;
    status?: number;
    title?: string;
    type?: string;
  }>;
  detail?: string;
  title?: string;
  error?: string;
};

type XApiPost = {
  id?: string;
  text?: string;
  created_at?: string;
  attachments?: {
    media_keys?: string[];
  };
  referenced_tweets?: Array<{
    id?: string;
    type?: string;
  }>;
};

type XApiPostsResponse = {
  data?: XApiPost[];
  includes?: {
    media?: Array<{
      media_key?: string;
      type?: string;
      url?: string;
      preview_image_url?: string;
    }>;
  };
  meta?: {
    result_count?: number;
  };
  errors?: Array<{
    detail?: string;
    status?: number;
    title?: string;
    type?: string;
  }>;
  detail?: string;
  title?: string;
  error?: string;
};

function resolveXApiBearerTokenFilePath() {
  return path.join(resolveUserDataDir(), X_API_BEARER_TOKEN_FILE_NAME);
}

function resolveXApiBearerToken() {
  const envToken = (
    process.env.CATPAW_X_API_BEARER_TOKEN
    || process.env.X_API_BEARER_TOKEN
    || ''
  ).trim();
  if (envToken) return envToken;

  try {
    const fileToken = fs.readFileSync(resolveXApiBearerTokenFilePath(), 'utf8').trim();
    return fileToken || null;
  } catch {
    return null;
  }
}

export function isXApiTwitterEnabled() {
  return Boolean(resolveXApiBearerToken());
}

export function getXApiBearerTokenFilePath() {
  return resolveXApiBearerTokenFilePath();
}

function normalizeTwitterHandle(value: string | null | undefined) {
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

function extractTwitterHandleFromXApiEndpointUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== X_API_ENDPOINT_PROTOCOL || parsed.hostname.toLowerCase() !== X_API_ENDPOINT_HOST) {
      return null;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0]?.toLowerCase() !== X_API_ENDPOINT_PATH || !segments[1]) {
      return null;
    }
    return normalizeTwitterHandle(decodeURIComponent(segments[1]));
  } catch {
    return null;
  }
}

export function resolveXApiTwitterHandle(input: {
  endpointUrl?: string | null;
  siteUrl?: string | null;
  url?: string | null;
}) {
  return (
    extractTwitterHandleFromXApiEndpointUrl(input.endpointUrl ?? '')
    || extractTwitterHandleFromXUrl(input.siteUrl ?? '')
    || extractTwitterHandleFromXUrl(input.url ?? '')
    || extractTwitterHandleFromOpenRssUrl(input.url ?? '')
    || extractTwitterHandleFromRsshubUrl(input.url ?? '')
    || null
  );
}

export function buildXApiTwitterEndpointUrl(handle: string) {
  return `${X_API_ENDPOINT_PROTOCOL}//${X_API_ENDPOINT_HOST}/${X_API_ENDPOINT_PATH}/${encodeURIComponent(handle)}`;
}

export function isAtlasNewsXApiTarget(input: {
  groupName?: string | null;
  parentGroupName?: string | null;
  siteUrl?: string | null;
  url?: string | null;
}) {
  if (!isXApiTwitterEnabled()) return false;
  if (input.groupName !== TARGET_GROUP_NAME || input.parentGroupName !== TARGET_PARENT_GROUP_NAME) {
    return false;
  }
  return Boolean(resolveXApiTwitterHandle({
    siteUrl: input.siteUrl ?? null,
    url: input.url ?? null,
  }));
}

async function parseJsonResponse<T>(response: Response) {
  if (typeof response.text !== 'function') {
    return {
      payload: await response.json() as T,
      rawText: null,
    };
  }

  const rawText = await response.text();
  if (!rawText.trim()) {
    return {
      payload: null as T | null,
      rawText: null,
    };
  }

  try {
    return {
      payload: JSON.parse(rawText) as T,
      rawText,
    };
  } catch {
    return {
      payload: null as T | null,
      rawText,
    };
  }
}

function createAuthorizationHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function getPrimaryErrorMessage(
  payload: {
    errors?: Array<{ detail?: string; title?: string; status?: number }>;
    detail?: string;
    title?: string;
    error?: string;
  } | null,
  rawText?: string | null,
) {
  const first = payload?.errors?.[0];
  if (first) {
    return first.detail || first.title || (first.status ? `HTTP ${first.status}` : null);
  }
  if (payload?.detail) return payload.detail;
  if (payload?.title) return payload.title;
  if (payload?.error) return payload.error;
  if (rawText?.trim()) {
    return rawText.trim().slice(0, 200);
  }
  return null;
}

async function lookupUserByHandle(handle: string, token: string) {
  const params = new URLSearchParams({
    'user.fields': 'id,username,name',
  });
  const response = await fetchWithTimeout(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?${params.toString()}`,
    {
      headers: createAuthorizationHeaders(token),
    },
    X_API_TIMEOUT_MS,
  );

  const { payload, rawText } = await parseJsonResponse<XApiUserLookupResponse>(response);
  if (!response.ok) {
    throw new Error(getPrimaryErrorMessage(payload, rawText) ?? `X_API_HTTP_${response.status}`);
  }

  if (!payload?.data?.id || !payload.data.username) {
    throw new Error(getPrimaryErrorMessage(payload, rawText) ?? 'X_API_USER_NOT_FOUND');
  }

  return {
    id: payload.data.id,
    username: payload.data.username,
    name: payload.data.name ?? payload.data.username,
  };
}

function extractNewestKnownTweetId(feedId: string) {
  const links = listFeedEntryLinks(feedId, 10);
  for (const link of links) {
    const match = link.match(TWEET_LINK_REGEX);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

async function fetchUserPosts(input: {
  userId: string;
  token: string;
  sinceId?: string | null;
  count: number;
}) {
  const params = new URLSearchParams({
    max_results: String(Math.max(5, Math.min(MAX_X_API_POST_COUNT, Math.floor(input.count)))),
    'tweet.fields': 'created_at,attachments,referenced_tweets,text',
    expansions: 'attachments.media_keys',
    'media.fields': 'media_key,url,preview_image_url,type',
  });
  if (input.sinceId) {
    params.set('since_id', input.sinceId);
  }

  const response = await fetchWithTimeout(
    `https://api.x.com/2/users/${encodeURIComponent(input.userId)}/tweets?${params.toString()}`,
    {
      headers: createAuthorizationHeaders(input.token),
    },
    X_API_TIMEOUT_MS,
  );

  const { payload, rawText } = await parseJsonResponse<XApiPostsResponse>(response);
  if (!response.ok) {
    throw new Error(getPrimaryErrorMessage(payload, rawText) ?? `X_API_HTTP_${response.status}`);
  }

  return payload ?? {};
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(input: string | null | undefined) {
  if (!input) return null;
  const normalized = input.replace(/\r\n/g, '\n').trim();
  return normalized || null;
}

function buildPostContentHtml(input: {
  text: string | null;
  referencedTweets?: Array<{ id?: string; type?: string }> | null;
}) {
  const parts: string[] = [];
  if (input.text) {
    parts.push(`<p>${escapeHtml(input.text).replace(/\n/g, '<br>')}</p>`);
  }
  const repost = (input.referencedTweets ?? []).find((item) => item.type === 'retweeted');
  if (repost?.id) {
    parts.push(`<p>Repost of ${escapeHtml(repost.id)}</p>`);
  }
  const reply = (input.referencedTweets ?? []).find((item) => item.type === 'replied_to');
  if (reply?.id) {
    parts.push(`<p>Reply to ${escapeHtml(reply.id)}</p>`);
  }
  return parts.length > 0 ? parts.join('') : null;
}

function parsePublishedAt(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function buildMediaMap(payload: XApiPostsResponse) {
  const map = new Map<string, string>();
  for (const media of payload.includes?.media ?? []) {
    if (!media.media_key) continue;
    const mediaUrl = media.url ?? media.preview_image_url ?? null;
    if (mediaUrl) {
      map.set(media.media_key, mediaUrl);
    }
  }
  return map;
}

export async function refreshXApiTwitterFeed(input: {
  syncTarget?: FeedSyncTarget;
  feedId: string;
  endpointUrl: string;
  siteUrl?: string | null;
  url?: string | null;
  count?: number | null;
}) {
  const syncTarget = input.syncTarget ?? getFeedSyncTarget(input.feedId);
  const token = resolveXApiBearerToken();
  if (!token) {
    throw new Error('X_API_BEARER_TOKEN_MISSING');
  }

  const handle = resolveXApiTwitterHandle({
    endpointUrl: input.endpointUrl,
    siteUrl: input.siteUrl ?? null,
    url: input.url ?? null,
  });
  if (!handle) {
    throw new Error('X_API_TWITTER_HANDLE_NOT_FOUND');
  }

  const startedAt = Date.now();
  const user = await lookupUserByHandle(handle, token);
  const newestKnownTweetId = extractNewestKnownTweetId(input.feedId);
  const payload = await fetchUserPosts({
    userId: user.id,
    token,
    sinceId: newestKnownTweetId,
    count: input.count ?? DEFAULT_X_API_POST_COUNT,
  });
  const mediaMap = buildMediaMap(payload);
  const posts = Array.isArray(payload.data) ? payload.data : [];

  for (const post of posts) {
    const postId = post.id?.trim();
    if (!postId) continue;
    const text = normalizeText(post.text);
    const mediaUrl = (post.attachments?.media_keys ?? [])
      .map((mediaKey) => mediaMap.get(mediaKey) ?? null)
      .find((value): value is string => Boolean(value)) ?? null;

    upsertEntry({
      feedId: input.feedId,
      syncTarget,
      guid: `tweet:${postId}`,
      title: buildPostTitle(text, user.username),
      link: `https://x.com/${user.username}/status/${postId}`,
      author: `@${user.username}`,
      publishedAt: parsePublishedAt(post.created_at),
      summary: text,
      contentHtml: buildPostContentHtml({
        text,
        referencedTweets: post.referenced_tweets ?? null,
      }),
      mediaUrl,
      mediaType: mediaUrl ? 'image' : null,
    });
  }

  updateFeedFetchMeta(input.feedId, { lastCheckedAt: Date.now() }, syncTarget);

  return {
    feedId: input.feedId,
    notModified: posts.length === 0 && Boolean(newestKnownTweetId),
    startedAt,
  };
}
