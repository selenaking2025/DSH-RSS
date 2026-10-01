import { randomUUID } from 'node:crypto';
import { getDb } from './db-core';
import type { Feed, FeedGroup } from './db-types';

function normalizeGroupName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

function assertGroupParent(parentId: string | null, groupId?: string) {
  if (!parentId) return;
  if (parentId === groupId) throw new Error('GROUP_CYCLE');
  const database = getDb();
  const parent = database.prepare('SELECT id, parent_id as parentId FROM feed_groups WHERE id = ?').get(parentId) as
    | { id: string; parentId: string | null }
    | undefined;
  if (!parent) throw new Error('GROUP_PARENT_NOT_FOUND');

  if (!groupId) return;
  let current: { id: string; parentId: string | null } | undefined = parent;
  const visited = new Set<string>();
  while (current) {
    if (current.id === groupId) throw new Error('GROUP_CYCLE');
    if (!current.parentId || visited.has(current.parentId)) break;
    visited.add(current.id);
    current = database.prepare('SELECT id, parent_id as parentId FROM feed_groups WHERE id = ?').get(current.parentId) as
      | { id: string; parentId: string | null }
      | undefined;
  }
}

function assertUniqueSiblingName(name: string, parentId: string | null, excludeId?: string) {
  const database = getDb();
  const duplicate = database
    .prepare(
      `SELECT id
       FROM feed_groups
       WHERE name = ? COLLATE NOCASE
         AND ((parent_id IS NULL AND ? IS NULL) OR parent_id = ?)
         AND (? IS NULL OR id != ?)
       LIMIT 1`,
    )
    .get(name, parentId, parentId, excludeId ?? null, excludeId ?? null) as { id: string } | undefined;
  if (duplicate) throw new Error('GROUP_NAME_EXISTS');
}

export function createGroup(name: string, parentId: string | null) {
  const database = getDb();
  const normalizedName = normalizeGroupName(name);
  if (!normalizedName) throw new Error('GROUP_NAME_REQUIRED');
  assertGroupParent(parentId);
  assertUniqueSiblingName(normalizedName, parentId);
  const id = randomUUID();
  const statement = database.prepare('INSERT INTO feed_groups (id, name, parent_id) VALUES (?, ?, ?)');
  statement.run(id, normalizedName, parentId);
  return id;
}

export function updateGroup(id: string, input: { name?: string; parentId?: string | null }) {
  const database = getDb();
  const existing = database.prepare('SELECT id, name, parent_id as parentId FROM feed_groups WHERE id = ?').get(id) as
    | FeedGroup
    | undefined;
  if (!existing) return { ok: false, error: 'GROUP_NOT_FOUND' as const };

  const nextName = input.name === undefined ? existing.name : normalizeGroupName(input.name);
  const nextParentId = input.parentId === undefined ? existing.parentId : input.parentId ?? null;
  if (!nextName) return { ok: false, error: 'GROUP_NAME_REQUIRED' as const };

  try {
    assertGroupParent(nextParentId, id);
    assertUniqueSiblingName(nextName, nextParentId, id);
    database.prepare('UPDATE feed_groups SET name = ?, parent_id = ? WHERE id = ?').run(nextName, nextParentId, id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function deleteGroup(id: string) {
  const database = getDb();
  const existing = database.prepare('SELECT id, parent_id as parentId FROM feed_groups WHERE id = ?').get(id) as
    | { id: string; parentId: string | null }
    | undefined;
  if (!existing) return { ok: false, error: 'GROUP_NOT_FOUND' as const };

  try {
    const moveConflict = database
      .prepare(
        `SELECT child.name as name
         FROM feed_groups child
         JOIN feed_groups sibling
           ON sibling.name = child.name COLLATE NOCASE
          AND sibling.id != ?
         WHERE child.parent_id = ?
           AND ((sibling.parent_id IS NULL AND ? IS NULL) OR sibling.parent_id = ?)
         LIMIT 1`,
      )
      .get(id, id, existing.parentId, existing.parentId) as { name: string } | undefined;
    if (moveConflict) {
      return { ok: false, error: 'GROUP_MOVE_NAME_CONFLICT' as const };
    }

    const moveThenDelete = database.transaction(() => {
      const movedFeeds = database.prepare('UPDATE feeds SET group_id = ? WHERE group_id = ?').run(existing.parentId, id).changes;
      const movedGroups = database.prepare('UPDATE feed_groups SET parent_id = ? WHERE parent_id = ?').run(existing.parentId, id).changes;
      database.prepare('DELETE FROM feed_groups WHERE id = ?').run(id);
      return { movedFeeds, movedGroups };
    });
    return { ok: true, ...moveThenDelete() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function listGroups(): FeedGroup[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT id, name, parent_id as parentId FROM feed_groups ORDER BY name')
    .all();
  return rows as FeedGroup[];
}

export function listFeeds(): Feed[] {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT id, sync_revision as syncRevision, title, url, site_url as siteUrl, group_id as groupId,
              content_type as contentType,
              source_type as sourceType,
              history_synced_at as historySyncedAt,
              enabled,
              fetch_interval_minutes as fetchIntervalMinutes,
              next_refresh_at as nextRefreshAt,
              last_checked_at as lastCheckedAt, last_modified as lastModified, etag,
              content_hash as contentHash, conditional_get_at as conditionalGetAt
       FROM feeds
       ORDER BY title COLLATE NOCASE`,
    )
    .all();
  return rows as Feed[];
}
