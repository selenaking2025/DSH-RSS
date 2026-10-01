const MAX_TITLE_WIDTH = 80;
const sentenceSegments = new Intl.Segmenter('zh', { granularity: 'sentence' });
const graphemeSegments = new Intl.Segmenter('zh', { granularity: 'grapheme' });

// Approximate the reading width: a Han character or emoji occupies about twice
// the space of a Latin character. Segmenting keeps combined emoji intact.
function graphemeWidth(text: string) {
  return /^[\x00-\x7f]+$/.test(text) ? 1 : 2;
}

function textWidth(text: string) {
  let width = 0;
  for (const { segment } of graphemeSegments.segment(text)) {
    width += graphemeWidth(segment);
  }
  return width;
}

export function isXPostLink(link: string | null | undefined) {
  if (!link) return false;
  try {
    const url = new URL(link);
    return ['https:', 'http:'].includes(url.protocol)
      && /^(?:www\.|mobile\.)?(?:x\.com|twitter\.com)$/i.test(url.hostname)
      && /^\/(?:[a-z0-9_]+|i\/web)\/status\/\d+(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** A local reading label; the original post remains in the summary and body. */
export function buildXPostTitle(text: string | null | undefined, username?: string) {
  const firstLine = text?.trim().split(/[\r\n]+/, 1)[0]?.replace(/\s+/g, ' ').trim();
  if (!firstLine) return username ? `Post by @${username}` : 'X 动态';

  let opening = '';
  for (const { segment } of sentenceSegments.segment(firstLine)) {
    opening += segment;
    // Keep a very short opener (e.g. "Yes.") with its following sentence.
    if (textWidth(opening.trim()) >= 16) break;
  }
  opening = opening.trim();
  if (textWidth(opening) <= MAX_TITLE_WIDTH) return opening;

  let prefix = '';
  let width = 0;
  let clauseBoundary = 0;
  let wordBoundary = 0;
  for (const { segment } of graphemeSegments.segment(opening)) {
    const nextWidth = width + graphemeWidth(segment);
    if (nextWidth > MAX_TITLE_WIDTH - 2) break;
    if (width >= MAX_TITLE_WIDTH / 2) {
      if (/[,，;；:：、]/u.test(segment)) clauseBoundary = prefix.length;
      else if (/\s/u.test(segment)) wordBoundary = prefix.length;
    }
    prefix += segment;
    width = nextWidth;
  }
  const boundary = clauseBoundary || wordBoundary;
  if (boundary) prefix = prefix.slice(0, boundary);
  return `${prefix.replace(/[\s,，;；:：、。.!?！？…-]+$/u, '')}…`;
}

export function getEntryDisplayTitle(entry: {
  title?: string | null;
  link?: string | null;
  summary?: string | null;
} | null | undefined) {
  if (!isXPostLink(entry?.link)) return entry?.title ?? '无标题';
  return buildXPostTitle(entry?.title || entry?.summary);
}
