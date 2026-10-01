import { extractWeChatBizFromUrl, buildWeChatNativeListingUrl } from '../sources/wechat-metadata';
export { extractWeChatBizFromUrl, buildWeChatNativeListingUrl, isWeChatNativeCandidate } from '../sources/wechat-metadata';
import { getFeedSyncTarget, type FeedSyncTarget } from '../data/feed-sync-repo';
import { JSDOM } from 'jsdom';
import { browserHtml } from '../browser/client';
import { upsertEntry } from '../data/entry-repo';
import { listFeedEntryLinks, updateFeedFetchMeta } from '../data/feed-write-repo';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

type WeChatListingArticle = {
  title: string;
  link: string;
  publishedAt: number | null;
  summary: string | null;
  coverUrl: string | null;
};

type WeChatListingPage = {
  content(): Promise<string>;
  evaluate<T>(pageFunction: () => T | Promise<T>): Promise<T>;
};

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeWeChatUrl(url: string | null | undefined) {
  if (!url) return null;
  const trimmed = decodeHtmlEntities(url).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `https://mp.weixin.qq.com${trimmed}`;
  return `https://mp.weixin.qq.com/${trimmed.replace(/^\/+/, '')}`;
}

function extractEmbeddedMsgList(html: string) {
  const patterns = [
    /var\s+msgList\s*=\s*'([^']+)'/i,
    /msgList\s*=\s*'([^']+)'/i,
    /var\s+general_msg_list\s*=\s*'([^']+)'/i,
    /general_msg_list\s*=\s*'([^']+)'/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const decoded = decodeHtmlEntities(match[1].replace(/\\'/g, "'"));
    try {
      return JSON.parse(decoded) as { list?: unknown[] } | null;
    } catch {
      continue;
    }
  }

  return null;
}

function parseWeChatArticlesFromPayload(payload: { list?: unknown[] } | null) {
  if (!payload?.list || !Array.isArray(payload.list)) {
    return [] as WeChatListingArticle[];
  }

  const articles: WeChatListingArticle[] = [];

  for (const item of payload.list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const publishedAt = typeof (record.comm_msg_info as Record<string, unknown> | undefined)?.datetime === 'number'
      ? ((record.comm_msg_info as Record<string, number>).datetime * 1000)
      : null;
    const ext = (record.app_msg_ext_info ?? null) as Record<string, unknown> | null;
    if (!ext) continue;

    const primaryLink = normalizeWeChatUrl(typeof ext.content_url === 'string' ? ext.content_url : null);
    const primaryTitle = typeof ext.title === 'string' ? ext.title.trim() : '';
    if (primaryLink && primaryTitle) {
      articles.push({
        title: primaryTitle,
        link: primaryLink,
        publishedAt,
        summary: typeof ext.digest === 'string' ? ext.digest.trim() : null,
        coverUrl: normalizeWeChatUrl(typeof ext.cover === 'string' ? ext.cover : null),
      });
    }

    const multiItems = Array.isArray(ext.multi_app_msg_item_list)
      ? ext.multi_app_msg_item_list as Array<Record<string, unknown>>
      : [];
    for (const child of multiItems) {
      const childLink = normalizeWeChatUrl(typeof child.content_url === 'string' ? child.content_url : null);
      const childTitle = typeof child.title === 'string' ? child.title.trim() : '';
      if (!childLink || !childTitle) continue;
      articles.push({
        title: childTitle,
        link: childLink,
        publishedAt,
        summary: typeof child.digest === 'string' ? child.digest.trim() : null,
        coverUrl: normalizeWeChatUrl(typeof child.cover === 'string' ? child.cover : null),
      });
    }
  }

  const seen = new Set<string>();
  return articles.filter((article) => {
    if (!article.link || seen.has(article.link)) return false;
    seen.add(article.link);
    return true;
  });
}

async function parseWeChatListingPage(page: WeChatListingPage) {
  const html = await page.content();
  const embedded = parseWeChatArticlesFromPayload(extractEmbeddedMsgList(html));
  if (embedded.length > 0) {
    return { articles: embedded, requiresLogin: false };
  }

  const requiresLogin = await page.evaluate(() => {
    const doc = (globalThis as unknown as {
      document?: {
        body?: { innerText?: string | null };
        querySelector?: (selector: string) => unknown;
      };
    }).document;
    const bodyText = (doc?.body?.innerText ?? '').slice(0, 1000);
    return Boolean(
      doc?.querySelector?.('#login_container, .weui-desktop-qrcheck, .login__type__container')
      || /登录|扫码|请在微信客户端打开链接/.test(bodyText),
    );
  });

  const domArticles = await page.evaluate(() => {
    const doc = (globalThis as unknown as {
      document?: {
        querySelectorAll?: (selector: string) => ArrayLike<unknown>;
        querySelector?: (selector: string) => unknown;
      };
    }).document;
    const selectors = [
      'a[href*="__biz="][href*="/s?"]',
      'a[href*="mp.weixin.qq.com/s?"]',
    ];
    const links = Array.from(new Set(selectors.flatMap((selector) => (
      Array.from(doc?.querySelectorAll?.(selector) ?? [])
        .map((node) => ((node as { href?: string | null }).href ?? '').trim())
        .filter(Boolean)
    ))));

    return links.map((link) => {
      const anchor = doc?.querySelector?.(`a[href="${link}"]`) as { textContent?: string | null } | null;
      const title = anchor?.textContent?.trim() ?? '';
      return { link, title };
    }).filter((item) => item.link && item.title);
  }) as Array<{ link: string; title: string }>;

  if (domArticles.length > 0) {
    return {
      articles: domArticles.map((item) => ({
        title: item.title,
        link: item.link,
        publishedAt: null,
        summary: null,
        coverUrl: null,
      })),
      requiresLogin,
    };
  }

  return { articles: [] as WeChatListingArticle[], requiresLogin };
}

function resolveWeChatBiz(input: {
  endpointUrl: string;
  siteUrl?: string | null;
  recentLinks?: string[];
}) {
  return (
    extractWeChatBizFromUrl(input.endpointUrl)
    || extractWeChatBizFromUrl(input.siteUrl ?? null)
    || input.recentLinks?.map((link) => extractWeChatBizFromUrl(link)).find(Boolean)
    || null
  );
}

export async function refreshWeChatNativeListing(input: {
  syncTarget?: FeedSyncTarget;
  feedId: string;
  endpointUrl: string;
  siteUrl?: string | null;
}) {
  const syncTarget = input.syncTarget ?? getFeedSyncTarget(input.feedId);
  const recentLinks = listFeedEntryLinks(input.feedId, 5);
  const biz = resolveWeChatBiz({
    endpointUrl: input.endpointUrl,
    siteUrl: input.siteUrl ?? null,
    recentLinks,
  });
  if (!biz) {
    throw new Error('WECHAT_BIZ_NOT_FOUND');
  }

  const listingUrl = buildWeChatNativeListingUrl(biz);
  const html = await browserHtml(listingUrl);
  const dom = new JSDOM(html, { url: listingUrl, runScripts: 'outside-only' });
  try {
    const { articles, requiresLogin } = await parseWeChatListingPage({
      content: async () => html,
      evaluate: async <T>(callback: () => T | Promise<T>) => dom.window.eval(`(${callback.toString()})()`) as T,
    });
    if (articles.length === 0) {
      if (requiresLogin) {
        throw new Error('WECHAT_LOGIN_REQUIRED');
      }
      throw new Error('WECHAT_LISTING_EMPTY');
    }

    const startedAt = Date.now();
    for (const article of articles.slice(0, 20)) {
      upsertEntry({
        feedId: input.feedId,
        syncTarget,
        guid: article.link,
        title: article.title,
        link: article.link,
        publishedAt: article.publishedAt,
        summary: article.summary,
        mediaUrl: article.coverUrl,
      });
    }
    updateFeedFetchMeta(input.feedId, { lastCheckedAt: Date.now() }, syncTarget);

    return {
      feedId: input.feedId,
      notModified: false,
      startedAt,
    };
  } finally {
    dom.window.close();
  }
}
