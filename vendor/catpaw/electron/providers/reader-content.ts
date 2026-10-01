import { fetchWithTimeout } from '../network/http';
import { JSDOM } from 'jsdom';
import { browserHtml, browserRequest } from '../browser/client';
import {
  getEntry,
  markEntryContentFetchResult,
  markEntryContentFetchStarted,
  updateEntryContent,
  updateEntryMedia,
} from '../data/entry-repo';

const { Readability } = require('@mozilla/readability') as { Readability: any };

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const XIAOYUZHOU_EPISODE_REGEX = /\/episode\/([A-Za-z0-9]+)/i;
const WEBPAGE_FETCH_TIMEOUT_MS = 15_000;
const WEBPAGE_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const FAST_PATH_ONLY_HOSTS = new Set(['baoyu.io']);

function isWeChatUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('mp.weixin.qq.com');
  } catch {
    return false;
  }
}

function normalizeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function shouldPreferFastPathOnly(url: string) {
  const host = normalizeHost(url);
  return host ? FAST_PATH_ONLY_HOSTS.has(host) : false;
}

function parseXiaoyuzhouEpisodeId(link: string | null): string | null {
  if (!link) return null;
  try {
    const parsed = new URL(link);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (!host.includes('xiaoyuzhoufm.com')) return null;
    const match = parsed.pathname.match(XIAOYUZHOU_EPISODE_REGEX);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function isLikelyAudioUrl(url: string, keyPath: string) {
  if (!/^https?:\/\//i.test(url)) return false;
  const normalizedPath = keyPath.toLowerCase();
  if (normalizedPath.includes('audio') || normalizedPath.includes('enclosure') || normalizedPath.includes('media')) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (/\.(mp3|aac|m4a|ogg|opus|wav|flac)$/.test(path)) return true;
    const host = parsed.hostname.toLowerCase();
    if (host.includes('media.xyzfm.space') || host.includes('audio') || host.includes('podcast')) return true;
  } catch {
    return false;
  }
  return false;
}

function findFirstAudioUrl(payload: unknown) {
  const queue: Array<{ value: unknown; keyPath: string }> = [{ value: payload, keyPath: '' }];
  const seen = new WeakSet<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (typeof current.value === 'string') {
      if (isLikelyAudioUrl(current.value, current.keyPath)) {
        return current.value;
      }
      continue;
    }

    if (!current.value || typeof current.value !== 'object') continue;
    if (seen.has(current.value)) continue;
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        queue.push({ value: item, keyPath: current.keyPath });
      }
      continue;
    }

    for (const [key, value] of Object.entries(current.value as Record<string, unknown>)) {
      const nextPath = current.keyPath ? `${current.keyPath}.${key}` : key;
      queue.push({ value, keyPath: nextPath });
    }
  }

  return null;
}

function findFirstStringField(payload: unknown, keys: string[]): string | null {
  const keySet = new Set(keys.map((key) => key.toLowerCase()));
  const queue: unknown[] = [payload];
  const seen = new WeakSet<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (keySet.has(key.toLowerCase()) && typeof value === 'string' && value.length > 0) {
        return value;
      }
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return null;
}

export async function resolveXiaoyuzhouAudio(entryId: string) {
  const entry = getEntry(entryId);
  if (!entry) return { ok: false, error: 'ENTRY_NOT_FOUND' as const };
  if (!entry.link) return { ok: false, error: 'NO_LINK' as const };

  const episodeId = parseXiaoyuzhouEpisodeId(entry.link);
  if (!episodeId) return { ok: false, error: 'NO_XIAOYUZHOU_EPISODE' as const };

  try {
    const url = `https://api.xiaoyuzhoufm.com/v1/episode/get?eid=${encodeURIComponent(episodeId)}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        applicationid: 'app.podcast.cosmos',
        referer: 'https://www.xiaoyuzhoufm.com/',
      },
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as unknown;
    const mediaUrl = findFirstAudioUrl(payload);
    if (!mediaUrl) {
      return { ok: false, error: 'NO_AUDIO_URL' as const };
    }
    updateEntryMedia(entryId, mediaUrl, 'audio');
    return { ok: true, mediaUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchXiaoyuzhouEpisodeContent(entryId: string) {
  const entry = getEntry(entryId);
  if (!entry?.link) return { ok: false, error: 'NO_LINK' as const };

  const episodeId = parseXiaoyuzhouEpisodeId(entry.link);
  if (!episodeId) return { ok: false, error: 'NO_XIAOYUZHOU_EPISODE' as const };

  try {
    const url = `https://api.xiaoyuzhoufm.com/v1/episode/get?eid=${encodeURIComponent(episodeId)}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        applicationid: 'app.podcast.cosmos',
      },
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };

    const payload = (await response.json()) as unknown;
    const shownotes = findFirstStringField(payload, ['shownotes', 'description']);
    if (shownotes && shownotes.length > 0) {
      updateEntryContent(entryId, shownotes, { markFetched: true });
    }

    if (!entry.mediaUrl) {
      const mediaUrl = findFirstAudioUrl(payload);
      if (mediaUrl) {
        updateEntryMedia(entryId, mediaUrl, 'audio');
      }
    }

    if (!shownotes) {
      markEntryContentFetchResult(entryId, { status: 'no_content', error: 'NO_CONTENT' });
      return { ok: false, error: 'NO_CONTENT' as const };
    }

    return { ok: true };
  } catch (error) {
    markEntryContentFetchResult(entryId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchHtml(url: string) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.text();
}

async function fetchWebpageHtmlFast(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBPAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': USER_AGENT,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
    if (Number.isFinite(contentLength) && contentLength > WEBPAGE_FETCH_MAX_BYTES) {
      throw new Error('RESPONSE_TOO_LARGE');
    }

    const html = await response.text();
    if (Buffer.byteLength(html, 'utf8') > WEBPAGE_FETCH_MAX_BYTES) {
      throw new Error('RESPONSE_TOO_LARGE');
    }

    return {
      html,
      resolvedUrl: response.url || url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractReadable(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  try {
    const reader = new Readability(dom.window.document);
    return reader.parse() as { content?: string; textContent?: string } | null;
  } finally {
    dom.window.close();
  }
}

async function extractWebpageFastPath(url: string) {
  const { html, resolvedUrl } = await fetchWebpageHtmlFast(url);
  const article = extractReadable(html, resolvedUrl);
  return {
    contentHtml: article?.content ?? null,
    contentText: article?.textContent?.trim() ?? null,
    resolvedUrl,
  };
}

async function extractWeChatWithBrowser(url: string, _userDataDir: string) {
  const html = await browserHtml(url, '#js_content');
  const dom = new JSDOM(html, { url });
  try { return dom.window.document.querySelector('#js_content')?.innerHTML ?? null; }
  finally { dom.window.close(); }
}

export async function openWeChatLogin(_userDataDir?: string) {
  const result = await browserRequest({ kind: 'wechat-login' });
  if (!('ok' in result)) throw new Error('BROWSER_INVALID_RESPONSE');
  return result;
}

async function extractWithBrowser(url: string, _userDataDir: string): Promise<string | null> {
  return extractReadable(await browserHtml(url), url)?.content ?? null;
}

export async function fetchEntryContent(entryId: string, userDataDir?: string | null) {
  const entry = getEntry(entryId);
  if (!entry) return { ok: false, error: 'ENTRY_NOT_FOUND' as const };
  if (!entry.link) return { ok: false, error: 'NO_LINK' as const };

  markEntryContentFetchStarted(entryId);

  try {
    if (parseXiaoyuzhouEpisodeId(entry.link)) {
      return await fetchXiaoyuzhouEpisodeContent(entryId);
    }

    let contentHtml: string | null = null;

    if (isWeChatUrl(entry.link)) {
      if (!userDataDir) {
        markEntryContentFetchResult(entryId, { status: 'failed', error: 'NO_PROFILE' });
        return { ok: false, error: 'NO_PROFILE' as const };
      }
      contentHtml = await extractWeChatWithBrowser(entry.link, userDataDir);
      if (!contentHtml) {
        markEntryContentFetchResult(entryId, { status: 'auth_required', error: 'WECHAT_LOGIN_REQUIRED' });
        return { ok: false, error: 'WECHAT_LOGIN_REQUIRED' as const };
      }
    } else {
      try {
        const fastPath = await extractWebpageFastPath(entry.link);
        contentHtml = fastPath.contentHtml;
      } catch (error) {
        if (!shouldPreferFastPathOnly(entry.link)) {
          try {
            const html = await fetchHtml(entry.link);
            const article = extractReadable(html, entry.link);
            contentHtml = article?.content ?? null;
          } catch {
            // Fall through to the shared browser when allowed below.
          }
        } else {
          console.info('[reader] fast-path fetch failed for fast-only host', {
            entryId,
            url: entry.link,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!contentHtml && shouldPreferFastPathOnly(entry.link)) {
        markEntryContentFetchResult(entryId, { status: 'no_content', error: 'FAST_PATH_NO_CONTENT' });
        return { ok: false, error: 'FAST_PATH_NO_CONTENT' as const };
      }

      if (!contentHtml && userDataDir) {
        contentHtml = await extractWithBrowser(entry.link, userDataDir);
      }
    }

    if (!contentHtml) {
      markEntryContentFetchResult(entryId, { status: 'no_content', error: 'NO_CONTENT' });
      return { ok: false, error: 'NO_CONTENT' as const };
    }

    updateEntryContent(entryId, contentHtml, { markFetched: true });
    return { ok: true };
  } catch (error) {
    markEntryContentFetchResult(entryId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
