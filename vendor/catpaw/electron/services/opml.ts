import { XMLParser } from 'fast-xml-parser';
import { createGroup, listFeeds, listGroups } from '../data/feed-repo';
import { upsertFeed } from '../data/feed-write-repo';
import { resolveFeedFromOutline } from '../sources/rsshub';
import { getDb } from '../data/db-core';
import type { OpmlPreviewSummary } from '../contracts/maintenance';
export type { OpmlPreviewSummary } from '../contracts/maintenance';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

type OutlineNode = {
  ['@_text']?: string;
  ['@_title']?: string;
  ['@_type']?: string;
  ['@_xmlUrl']?: string;
  ['@_htmlUrl']?: string;
  outline?: OutlineNode[] | OutlineNode;
};

type PlannedGroup = {
  key: string;
  name: string;
  parentKey: string | null;
  existingId: string | null;
};

type PlannedFeed = {
  title: string | null;
  url: string;
  siteUrl: string | null;
  groupKey: string | null;
};


function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function importOpmlFromString(xml: string) {
  return importOpmlFromStringWithOptions(xml, {});
}

function normalizeGroupName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

function canonicalizeFeedUrl(url: string) {
  try {
    return new URL(url.trim()).href;
  } catch {
    return url.trim();
  }
}

function buildOpmlPlan(xml: string, rootGroupId: string | null) {
  const data = parser.parse(xml);
  const outlines = asArray<OutlineNode>(data?.opml?.body?.outline);
  const groups = listGroups();
  const feeds = listFeeds();
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const existingGroupByParentAndName = new Map<string, string>();
  for (const group of groups) {
    existingGroupByParentAndName.set(`${group.parentId ?? 'root'}\n${group.name.toLocaleLowerCase()}`, group.id);
  }
  const validRootGroupId = rootGroupId && groupById.has(rootGroupId) ? rootGroupId : null;
  const rootKey = validRootGroupId ? `id:${validRootGroupId}` : null;
  const existingFeedUrls = new Set(feeds.map((feed) => canonicalizeFeedUrl(feed.url)));
  const seenFeedUrls = new Set<string>();
  const plannedGroupByKey = new Map<string, PlannedGroup>();
  const plannedGroups: PlannedGroup[] = [];
  const plannedFeeds: PlannedFeed[] = [];
  const reusedGroupIds = new Set<string>();
  let existingFeedCount = 0;
  let duplicateFeedCount = 0;
  let invalidFeedCount = 0;

  const resolveGroup = (name: string, parentKey: string | null) => {
    const normalizedName = normalizeGroupName(name);
    const normalizedParentKey = parentKey ?? 'root';
    const key = `${normalizedParentKey}\n${normalizedName.toLocaleLowerCase()}`;
    const alreadyPlanned = plannedGroupByKey.get(key);
    if (alreadyPlanned) return alreadyPlanned.key;

    const actualParentId = parentKey?.startsWith('id:') ? parentKey.slice(3) : null;
    const existingId = parentKey === null || actualParentId
      ? existingGroupByParentAndName.get(`${actualParentId ?? 'root'}\n${normalizedName.toLocaleLowerCase()}`) ?? null
      : null;
    const group: PlannedGroup = {
      key: existingId ? `id:${existingId}` : `new:${key}`,
      name: normalizedName,
      parentKey,
      existingId,
    };
    plannedGroupByKey.set(key, group);
    plannedGroups.push(group);
    if (existingId) reusedGroupIds.add(existingId);
    return group.key;
  };

  const walk = (nodes: OutlineNode[], parentKey: string | null) => {
    for (const node of nodes) {
      const rawTitle = node['@_text'] || node['@_title'] || '';
      const title = normalizeGroupName(rawTitle) || null;
      const resolved = resolveFeedFromOutline({
        xmlUrl: node['@_xmlUrl'],
        htmlUrl: node['@_htmlUrl'],
        title,
        text: title,
      });
      if (resolved) {
        const urlKey = canonicalizeFeedUrl(resolved.url);
        if (!urlKey) {
          invalidFeedCount += 1;
        } else if (seenFeedUrls.has(urlKey)) {
          duplicateFeedCount += 1;
        } else {
          seenFeedUrls.add(urlKey);
          if (existingFeedUrls.has(urlKey)) {
            existingFeedCount += 1;
          } else {
            plannedFeeds.push({
              title: title ?? resolved.title ?? null,
              url: resolved.url,
              siteUrl: resolved.siteUrl ?? (node['@_htmlUrl'] ?? null),
              groupKey: parentKey,
            });
          }
        }
        continue;
      }

      const childNodes = asArray(node.outline);
      if (childNodes.length > 0) {
        const nextParentKey = title ? resolveGroup(title, parentKey) : parentKey;
        walk(childNodes, nextParentKey);
        continue;
      }

      const looksLikeFeed = Boolean(node['@_xmlUrl'] || node['@_htmlUrl'] || /rss|atom/i.test(node['@_type'] ?? ''));
      if (looksLikeFeed) invalidFeedCount += 1;
    }
  };

  walk(outlines, rootKey);
  return {
    plannedGroups,
    plannedFeeds,
    summary: {
      newGroupCount: plannedGroups.filter((group) => !group.existingId).length,
      reusedGroupCount: reusedGroupIds.size,
      newFeedCount: plannedFeeds.length,
      existingFeedCount,
      duplicateFeedCount,
      invalidFeedCount,
    } satisfies OpmlPreviewSummary,
  };
}

export function previewOpmlFromStringWithOptions(
  xml: string,
  options?: { rootGroupId?: string | null },
): OpmlPreviewSummary {
  return buildOpmlPlan(xml, options?.rootGroupId ?? null).summary;
}

export function importOpmlFromStringWithOptions(
  xml: string,
  options?: {
    rootGroupId?: string | null;
  },
  progress?: (completed: number, total: number) => void,
) {
  return getDb().transaction(() => {
  const plan = buildOpmlPlan(xml, options?.rootGroupId ?? null);
  const groupIdByKey = new Map<string, string>();
  const feedIds: string[] = [];
  progress?.(0, plan.plannedFeeds.length);

  const resolveGroupId = (key: string | null) => {
    if (!key) return null;
    if (key.startsWith('id:')) return key.slice(3);
    return groupIdByKey.get(key) ?? null;
  };

  for (const group of plan.plannedGroups) {
    if (group.existingId) {
      groupIdByKey.set(group.key, group.existingId);
      continue;
    }
    const groupId = createGroup(group.name, resolveGroupId(group.parentKey));
    groupIdByKey.set(group.key, groupId);
  }

  for (const feed of plan.plannedFeeds) {
    const feedId = upsertFeed({
      title: feed.title,
      url: feed.url,
      siteUrl: feed.siteUrl,
      groupId: resolveGroupId(feed.groupKey),
    });
    feedIds.push(feedId);
    if (feedIds.length % 100 === 0 || feedIds.length === plan.plannedFeeds.length) progress?.(feedIds.length, plan.plannedFeeds.length);
  }

  return {
    ...plan.summary,
    groupCount: plan.summary.newGroupCount,
    feedCount: plan.summary.newFeedCount,
    feedIds,
  };
  }).immediate();
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportOpml(): string {
  const groups = listGroups();
  const feeds = listFeeds();

  const groupMap = new Map(groups.map((g) => [g.id, { ...g, children: [] as string[], feeds: [] as typeof feeds } ]));

  for (const feed of feeds) {
    if (feed.groupId && groupMap.has(feed.groupId)) {
      groupMap.get(feed.groupId)!.feeds.push(feed);
    }
  }

  for (const group of groups) {
    if (group.parentId && groupMap.has(group.parentId)) {
      groupMap.get(group.parentId)!.children.push(group.id);
    }
  }

  const renderFeed = (feed: typeof feeds[number]) => {
    const text = escapeXml(feed.title ?? feed.url);
    const xmlUrl = escapeXml(feed.url);
    const htmlUrl = feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : '';
    return `<outline text="${text}" title="${text}" type="rss" xmlUrl="${xmlUrl}"${htmlUrl} />`;
  };

  const renderGroup = (groupId: string): string => {
    const group = groupMap.get(groupId);
    if (!group) return '';
    const title = escapeXml(group.name);
    const childGroups = group.children.map(renderGroup).join('');
    const childFeeds = group.feeds.map(renderFeed).join('');
    return `<outline text="${title}" title="${title}">${childGroups}${childFeeds}</outline>`;
  };

  const rootGroups = groups.filter((g) => !g.parentId).map((g) => renderGroup(g.id)).join('');
  const ungroupedFeeds = feeds.filter((f) => !f.groupId).map(renderFeed).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Catpaw RSS</title>
  </head>
  <body>
    ${rootGroups}${ungroupedFeeds}
  </body>
</opml>`;
}
