import { randomUUID } from 'node:crypto';
import { getDb } from './db-core';
import type { PipelineRun, PipelineRunStatus, PipelineRunType } from './db-types';

export function createPipelineRun(input: {
  runType: PipelineRunType;
  trigger: string;
  status?: PipelineRunStatus;
  startedAt?: number;
  totalFeeds?: number;
  metadata?: unknown;
}) {
  const database = getDb();
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO pipeline_runs
       (id, run_type, trigger, status, started_at, total_feeds, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.runType,
      input.trigger,
      input.status ?? 'running',
      input.startedAt ?? Date.now(),
      input.totalFeeds ?? 0,
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
    );
  return id;
}

export function updatePipelineRun(id: string, patch: {
  status?: PipelineRunStatus;
  finishedAt?: number | null;
  totalFeeds?: number;
  feedsCompleted?: number;
  feedsSucceeded?: number;
  feedsFailed?: number;
  newEntries?: number;
  error?: string | null;
  metadata?: unknown;
}) {
  const database = getDb();
  const existing = database
    .prepare(
      `SELECT
         status as status,
         finished_at as finishedAt,
         total_feeds as totalFeeds,
         feeds_completed as feedsCompleted,
         feeds_succeeded as feedsSucceeded,
         feeds_failed as feedsFailed,
         new_entries as newEntries,
         error as error,
         metadata_json as metadataJson
       FROM pipeline_runs
       WHERE id = ?`,
    )
    .get(id) as Omit<PipelineRun, 'id' | 'runType' | 'trigger' | 'startedAt'> | undefined;

  if (!existing) {
    return false;
  }

  database
    .prepare(
      `UPDATE pipeline_runs
       SET status = ?, finished_at = ?, total_feeds = ?, feeds_completed = ?, feeds_succeeded = ?,
           feeds_failed = ?, new_entries = ?, error = ?, metadata_json = ?
       WHERE id = ?`,
    )
    .run(
      patch.status ?? existing.status,
      patch.finishedAt === undefined ? existing.finishedAt : patch.finishedAt,
      patch.totalFeeds ?? existing.totalFeeds,
      patch.feedsCompleted ?? existing.feedsCompleted,
      patch.feedsSucceeded ?? existing.feedsSucceeded,
      patch.feedsFailed ?? existing.feedsFailed,
      patch.newEntries ?? existing.newEntries,
      patch.error === undefined ? existing.error : patch.error,
      patch.metadata === undefined ? existing.metadataJson : JSON.stringify(patch.metadata),
      id,
    );
  return true;
}

export function listPipelineRuns(params?: {
  runType?: PipelineRunType | null;
  limit?: number | null;
}) {
  const database = getDb();
  const conditions: string[] = ["run_type IN ('refresh', 'backfill')"];
  const values: Array<string | number> = [];

  if (params?.runType) {
    conditions.push('run_type = ?');
    values.push(params.runType);
  }

  const whereClause = ` WHERE ${conditions.join(' AND ')}`;
  const limit = Math.max(1, Math.min(50, Math.floor(params?.limit ?? 10)));
  const rows = database
    .prepare(
      `SELECT
         id as id,
         run_type as runType,
         trigger as trigger,
         status as status,
         started_at as startedAt,
         finished_at as finishedAt,
         total_feeds as totalFeeds,
         feeds_completed as feedsCompleted,
         feeds_succeeded as feedsSucceeded,
         feeds_failed as feedsFailed,
         new_entries as newEntries,
         error as error,
         metadata_json as metadataJson
       FROM pipeline_runs
       ${whereClause}
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(...values, limit);
  return rows as PipelineRun[];
}
