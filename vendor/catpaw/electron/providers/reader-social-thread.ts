import { JSDOM } from 'jsdom';
import { getEntry, listEntries } from '../data/entry-repo';

const TWEET_LINK_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/(?:(?:i\/web\/status)|(?:([A-Za-z0-9_]{1,30})\/status))\/(\d+)/i;
const TWEET_REF_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/(?:(?:i\/web\/status)|(?:[A-Za-z0-9_]{1,30}\/status))\/(\d+)/gi;
const MAX_THREAD_SOURCE_ENTRIES = 500;

type ThreadNode = {
  entryId: string;
  tweetId: string;
  username: string;
  link: string;
  publishedAt: number | null;
  text: string;
  refs: string[];
};

function parseTweetIdentity(link: string | null): { username: string; tweetId: string } | null {
  if (!link) return null;
  const match = link.match(TWEET_LINK_REGEX);
  if (!match) return null;
  return { username: match[1] ?? '', tweetId: match[2] };
}

function extractTweetRefs(...sources: Array<string | null | undefined>) {
  const ids = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    let match: RegExpExecArray | null = null;
    TWEET_REF_REGEX.lastIndex = 0;
    while ((match = TWEET_REF_REGEX.exec(source)) !== null) {
      if (match[1]) ids.add(match[1]);
    }
  }
  return Array.from(ids);
}

function toPlainText(contentHtml: string | null, summary: string | null): string {
  const source = (contentHtml && contentHtml.trim()) || (summary && summary.trim()) || '';
  if (!source) return '';
  const dom = new JSDOM(`<body>${source}</body>`);
  try {
    return (dom.window.document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  } finally {
    dom.window.close();
  }
}

function pickClosestParent(
  node: { publishedAt: number | null; refs: string[] },
  byTweetId: Map<string, { tweetId: string; publishedAt: number | null }>,
) {
  const refs = node.refs
    .map((id) => byTweetId.get(id))
    .filter((value): value is { tweetId: string; publishedAt: number | null } => Boolean(value));
  if (!refs.length) return null;

  const nodeTs = node.publishedAt ?? Number.MAX_SAFE_INTEGER;
  const olderRefs = refs.filter((ref) => (ref.publishedAt ?? Number.MAX_SAFE_INTEGER) <= nodeTs);
  if (olderRefs.length) {
    olderRefs.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    return olderRefs[0];
  }

  refs.sort((a, b) => (a.publishedAt ?? Number.MAX_SAFE_INTEGER) - (b.publishedAt ?? Number.MAX_SAFE_INTEGER));
  return refs[0];
}

export function getSocialThread(entryId: string) {
  const selectedEntry = getEntry(entryId);
  if (!selectedEntry) return { ok: false, error: 'ENTRY_NOT_FOUND' as const };

  const selectedIdentity = parseTweetIdentity(selectedEntry.link);
  if (!selectedIdentity) {
    return {
      ok: true,
      items: [] as Array<{ entryId: string; tweetId: string; link: string; publishedAt: number | null; text: string }>,
    };
  }

  const feedEntries = listEntries({
    feedId: selectedEntry.feedId,
    mode: 'full',
    limit: MAX_THREAD_SOURCE_ENTRIES,
  });
  const candidates: ThreadNode[] = [];

  for (const entry of feedEntries) {
    const identity = parseTweetIdentity(entry.link);
    if (!identity || !entry.link) continue;
    const refs = extractTweetRefs(entry.contentHtml, entry.summary).filter((id) => id !== identity.tweetId);
    candidates.push({
      entryId: entry.id,
      tweetId: identity.tweetId,
      username: identity.username,
      link: entry.link,
      publishedAt: entry.publishedAt ?? null,
      text: toPlainText(entry.contentHtml, entry.summary),
      refs,
    });
  }

  if (!candidates.length) {
    return {
      ok: true,
      items: [] as Array<{ entryId: string; tweetId: string; link: string; publishedAt: number | null; text: string }>,
    };
  }

  candidates.sort((a, b) => (a.publishedAt ?? Number.MAX_SAFE_INTEGER) - (b.publishedAt ?? Number.MAX_SAFE_INTEGER));
  const byTweetId = new Map<string, ThreadNode>();

  for (const candidate of candidates) {
    const existing = byTweetId.get(candidate.tweetId);
    if (!existing) {
      byTweetId.set(candidate.tweetId, candidate);
      continue;
    }

    const merged = {
      ...existing,
      entryId: candidate.publishedAt && existing.publishedAt && candidate.publishedAt < existing.publishedAt ? candidate.entryId : existing.entryId,
      link: candidate.link || existing.link,
      publishedAt: existing.publishedAt ?? candidate.publishedAt,
      text: existing.text.length >= candidate.text.length ? existing.text : candidate.text,
      refs: Array.from(new Set([...existing.refs, ...candidate.refs])),
    };
    byTweetId.set(candidate.tweetId, merged);
  }

  const selectedNode = byTweetId.get(selectedIdentity.tweetId);
  if (!selectedNode) {
    const fallbackText = toPlainText(selectedEntry.contentHtml ?? null, selectedEntry.summary ?? null);
    return {
      ok: true,
      items: [
        {
          entryId: selectedEntry.id,
          tweetId: selectedIdentity.tweetId,
          link: selectedEntry.link ?? '',
          publishedAt: selectedEntry.publishedAt ?? null,
          text: fallbackText,
        },
      ],
    };
  }

  const parentByTweet = new Map<string, string>();
  const childrenByTweet = new Map<string, ThreadNode[]>();

  for (const node of byTweetId.values()) {
    const parent = pickClosestParent(node, byTweetId);
    if (!parent || parent.tweetId === node.tweetId) continue;
    parentByTweet.set(node.tweetId, parent.tweetId);
    if (!childrenByTweet.has(parent.tweetId)) childrenByTweet.set(parent.tweetId, []);
    childrenByTweet.get(parent.tweetId)!.push(node);
  }

  for (const nodes of childrenByTweet.values()) {
    nodes.sort((a, b) => (a.publishedAt ?? Number.MAX_SAFE_INTEGER) - (b.publishedAt ?? Number.MAX_SAFE_INTEGER));
  }

  const ancestors: ThreadNode[] = [];
  const ancestorVisited = new Set<string>([selectedNode.tweetId]);
  let cursor = selectedNode;
  while (true) {
    const parentId = parentByTweet.get(cursor.tweetId);
    if (!parentId || ancestorVisited.has(parentId)) break;
    const parent = byTweetId.get(parentId);
    if (!parent) break;
    ancestors.push(parent);
    ancestorVisited.add(parentId);
    cursor = parent;
  }
  ancestors.reverse();

  const descendants: ThreadNode[] = [];
  const descendantVisited = new Set<string>([selectedNode.tweetId]);
  const queue = [selectedNode.tweetId];
  while (queue.length) {
    const tweetId = queue.shift()!;
    for (const child of childrenByTweet.get(tweetId) ?? []) {
      if (descendantVisited.has(child.tweetId)) continue;
      descendantVisited.add(child.tweetId);
      descendants.push(child);
      queue.push(child.tweetId);
    }
  }

  const ordered = [...ancestors, selectedNode, ...descendants];
  const deduped: ThreadNode[] = [];
  const seen = new Set<string>();
  for (const node of ordered) {
    if (seen.has(node.tweetId)) continue;
    seen.add(node.tweetId);
    deduped.push(node);
  }

  return {
    ok: true,
    items: deduped.map((node) => ({
      entryId: node.entryId,
      tweetId: node.tweetId,
      link: node.link,
      publishedAt: node.publishedAt,
      text: node.text,
    })),
  };
}
