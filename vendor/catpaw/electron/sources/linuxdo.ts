const ORIGIN = 'https://linux.do';
const periods = new Set(['all', 'yearly', 'quarterly', 'monthly', 'weekly', 'daily']);

function siteUrl(input: string) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'linux.do' || url.port || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

/** Only native, read-only Discourse feeds are eligible for the site session. */
export function linuxDoFeeds(input: string): Array<{ url: string; title: string; siteUrl: string }> {
  const url = siteUrl(input);
  if (!url) return [];
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const base = path.replace(/\.rss$/, '');
  const make = (route: string, title: string) => {
    const feed = new URL(route + '.rss', ORIGIN);
    if (url.searchParams.get('order') === 'created') feed.searchParams.set('order', 'created');
    const period = url.searchParams.get('period');
    if (base === '/top' && period && periods.has(period)) feed.searchParams.set('period', period);
    return { url: feed.href, title: `Linux DO · ${title}`, siteUrl: ORIGIN + route };
  };
  if (path === '/') return [make('/latest', '最新话题'), make('/top', '热门话题')];
  const lists: Record<string, string> = { '/latest': '最新话题', '/top': '热门话题', '/hot': '热门动态', '/posts': '最新回复' };
  if (lists[base]) return [make(base, lists[base])];
  let decoded: string;
  try { decoded = decodeURIComponent(base); } catch { return []; }
  if (decoded.includes('\\') || /[\x00-\x20?#]/.test(decoded) || decoded.split('/').some((part) => part === '.' || part === '..')
    || /%2f/i.test(base)) return [];
  if (/^\/c\/(?:[^/]+\/){1,2}[1-9]\d*$/.test(base)) return [make(base, '分类话题')];
  if (/^\/tags?\/[^/]+(?:\/[1-9]\d*)?$/.test(base)) return [make(base.replace(/^\/tags\//, '/tag/'), '标签话题')];
  const numericTopic = base.match(/^\/t\/([1-9]\d*)(?:\/[1-9]\d*)?$/);
  if (numericTopic) return [make(`/t/topic/${numericTopic[1]}`, '话题回复')];
  const topic = base.match(/^\/t\/([^/]+)\/([1-9]\d*)(?:\/[1-9]\d*)?$/);
  if (topic) return [make(`/t/${topic[1] || 'topic'}/${topic[2]}`, '话题回复')];
  return [];
}

export function isLinuxDoFeedUrl(input: string) {
  const url = siteUrl(input);
  if (!url || !url.pathname.endsWith('.rss') || url.hash) return false;
  return linuxDoFeeds(input).some((feed) => feed.url === url.href);
}

export function linuxDoNavigationAllowed(input: string) {
  return siteUrl(input) !== null;
}
