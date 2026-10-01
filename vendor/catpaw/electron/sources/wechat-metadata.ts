export function extractWeChatBizFromUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const biz = parsed.searchParams.get('__biz');
    return biz?.trim() || null;
  } catch {
    return null;
  }
}

export function buildWeChatNativeListingUrl(biz: string) {
  return `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(biz)}&scene=124#wechat_redirect`;
}

export function isWeChatNativeCandidate(input: {
  sourceType?: string | null;
  url?: string | null;
  siteUrl?: string | null;
}) {
  if (input.sourceType === 'wechat-native-listing') {
    return true;
  }
  if (input.sourceType === 'wechat2rss' || input.sourceType === 'rsshub-wechat') {
    return true;
  }
  return Boolean(
    extractWeChatBizFromUrl(input.url)
    || extractWeChatBizFromUrl(input.siteUrl)
    || input.url?.includes('wechat2rss')
    || input.url?.includes('/wechat/')
    || input.siteUrl?.includes('mp.weixin.qq.com'),
  );
}
