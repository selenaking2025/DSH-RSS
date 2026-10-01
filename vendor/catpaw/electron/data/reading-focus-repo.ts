import { randomUUID } from 'node:crypto';
import { getDb } from './db-core';
import { ReadingError, type ReadingFocus, type SaveReadingFocus } from '../contracts/smart-reading';

function decode(row: any): ReadingFocus {
  return { id: row.id, revision: row.revision, title: row.title, goal: row.goal, prefer: row.prefer, avoid: row.avoid,
    feedIds: JSON.parse(row.feed_ids), groupIds: JSON.parse(row.group_ids), priority: row.priority,
    expiresAt: row.expires_at, enabled: Boolean(row.enabled), archived: Boolean(row.archived), ephemeral: Boolean(row.ephemeral), updatedAt: row.updated_at };
}
export function listReadingFocuses(includeQueries = false): ReadingFocus[] {
  return (getDb().prepare(`SELECT * FROM reading_focuses ${includeQueries ? '' : 'WHERE ephemeral = 0'} ORDER BY archived, updated_at DESC`).all()).map(decode);
}
export function getReadingFocus(id: string): ReadingFocus | null {
  const row = getDb().prepare('SELECT * FROM reading_focuses WHERE id = ?').get(id); return row ? decode(row) : null;
}
export function activeReadingFocuses(now = Date.now()) {
  return listReadingFocuses().filter((f) => f.enabled && !f.archived && (f.expiresAt === null || f.expiresAt > now));
}
export function saveReadingFocus(input: SaveReadingFocus): ReadingFocus {
  if (!input.title.trim() || !input.goal.trim() || input.title.length > 80 || input.goal.length > 2000
    || input.prefer.length > 1000 || input.avoid.length > 1000 || input.priority < 1 || input.priority > 3
    || !Number.isInteger(input.priority) || input.feedIds.length > 500 || input.groupIds.length > 100) throw new ReadingError('请填写关注事项名称、目标和有效范围。');
  const db = getDb();
  return db.transaction(() => {
    const previous = input.id ? getReadingFocus(input.id) : null;
    if (input.id && (!previous || previous.revision !== input.revision)) throw new ReadingError('关注事项已被修改，请重新打开后编辑。');
    if ((!previous || previous.ephemeral) && listReadingFocuses().length >= 100 && !input.ephemeral) throw new ReadingError('最多保存 100 个关注事项。');
    for (const [ids, table] of [[input.feedIds, 'feeds'], [input.groupIds, 'feed_groups']] as const) {
      const find = db.prepare(`SELECT id FROM ${table} WHERE id = ?`);
      if (ids.some((id) => !find.get(id))) throw new ReadingError('选择的订阅或文件夹已不存在，请重新选择。');
    }
    const id = previous?.id ?? randomUUID(), revision = (previous?.revision ?? 0) + 1;
    db.prepare(`INSERT INTO reading_focuses VALUES (@id, @revision, @title, @goal, @prefer, @avoid, @feedIds, @groupIds,
      @priority, @expiresAt, @enabled, @archived, @ephemeral, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, title=excluded.title, goal=excluded.goal,
      prefer=excluded.prefer, avoid=excluded.avoid, feed_ids=excluded.feed_ids, group_ids=excluded.group_ids,
      priority=excluded.priority, expires_at=excluded.expires_at, enabled=excluded.enabled, archived=excluded.archived,
      ephemeral=excluded.ephemeral, updated_at=excluded.updated_at`).run({ id, revision, title: input.title.trim(), goal: input.goal.trim(),
      prefer: input.prefer.trim(), avoid: input.avoid.trim(), feedIds: JSON.stringify([...new Set(input.feedIds)]),
      groupIds: JSON.stringify([...new Set(input.groupIds)]), priority: input.priority, expiresAt: input.expiresAt,
      enabled: +input.enabled, archived: +input.archived, ephemeral: +input.ephemeral, updatedAt: Date.now() });
    db.prepare('DELETE FROM reading_scores WHERE focus_id = ?').run(id);
    // Ad-hoc searches are bounded; saved interests and their feedback are retained.
    db.prepare(`DELETE FROM reading_focuses WHERE ephemeral=1 AND id<>? AND id NOT IN
      (SELECT id FROM reading_focuses WHERE ephemeral=1 AND id<>? ORDER BY updated_at DESC,rowid DESC LIMIT ?)`)
      .run(id, id, input.ephemeral ? 19 : 20);
    return getReadingFocus(id)!;
  }).immediate();
}
