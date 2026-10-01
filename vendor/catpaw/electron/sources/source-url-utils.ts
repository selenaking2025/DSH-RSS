export function extractWeChat2RssId(url: string) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes('wechat2rss')) return null;
    return parsed.pathname.match(/\/feed\/([0-9a-f]{32,64})\.xml$/i)?.[1] ?? null;
  } catch { return null; }
}

export function dedupeUrls(candidates: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = candidate.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
  }
  return urls;
}

export function toRsshubAppVariant(url: string) {
  try {
    const wechat2rssId = extractWeChat2RssId(url);
    if (wechat2rssId) {
      return `https://rsshub.app/wechat/wechat2rss/${wechat2rssId}`;
    }

    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host.startsWith('rsshub.') || host.includes('bestblogs.dev')) {
      return `https://rsshub.app${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return null;
  }
  return null;
}
