import { getDb } from './db-core';
import type {
  FeedSyncState,
  FeedFailureSummary,
  FeedRunDiagnostic,
  ProviderClass,
  ProviderHealthSummaryBucket,
  RefreshEndpointCandidate,
  SourceEndpointHealth,
  SourceEndpointHealthSummary,
} from './db-types';
import {
  ensureSourceEndpointSeedData,
  recordFeedRunResult,
  syncSourceEndpointForFeedById,
  upsertSourceEndpointForFeed,
} from './source-endpoint-sync';
import { getProviderClass } from '../sources/endpoint-utils';

function createEmptyProviderHealthBucket(): ProviderHealthSummaryBucket {
  return {
    total: 0,
    active: 0,
    degraded: 0,
    cooldown: 0,
  };
}

function createEmptyProviderHealthSummaryRecord() {
  return {
    native: createEmptyProviderHealthBucket(),
    bridge: createEmptyProviderHealthBucket(),
    adapter: createEmptyProviderHealthBucket(),
    unknown: createEmptyProviderHealthBucket(),
  } satisfies Record<ProviderClass, ProviderHealthSummaryBucket>;
}

function createEmptyFailureSummaryRecord() {
  return {
    native: 0,
    bridge: 0,
    adapter: 0,
    unknown: 0,
  } satisfies Record<ProviderClass, number>;
}

export function ensureSourceEndpointRecords() {
  ensureSourceEndpointSeedData(getDb());
}

export function syncSourceEndpointRecordsForFeed(feedId: string) {
  return syncSourceEndpointForFeedById(getDb(), feedId);
}

export function createFeedRunResult(input: {
  pipelineRunId: string;
  feedId: string;
  endpointId?: string | null;
  runType: 'refresh' | 'backfill';
  trigger: string;
  startedAt: number;
  finishedAt: number;
  status: 'success' | 'failed' | 'not_modified' | 'cancelled';
  error?: string | null;
  notModified?: boolean;
  newEntries?: number;
  affectsEndpointHealth?: boolean;
}) {
  return recordFeedRunResult(getDb(), input);
}

export function upsertSourceEndpointRecord(input: {
  feedId: string;
  endpointRole: 'primary' | 'fallback';
  endpointUrl: string;
  providerType?: string | null;
  managedBy?: 'system' | 'user';
  roleLocked?: boolean;
}) {
  return upsertSourceEndpointForFeed(getDb(), input);
}

export function removeUserSourceEndpointsForFeed(feedId: string, providerType: string) {
  const result = getDb()
    .prepare(
      `DELETE FROM source_endpoints
       WHERE feed_id = ? AND provider_type = ? AND managed_by = 'user'`,
    )
    .run(feedId, providerType);
  return { ok: true, removed: result.changes };
}

export function hasUserSourceEndpoint(feedId: string, providerType: string) {
  const row = getDb()
    .prepare(
      `SELECT 1 as found
       FROM source_endpoints
       WHERE feed_id = ? AND provider_type = ? AND managed_by = 'user'
       LIMIT 1`,
    )
    .get(feedId, providerType) as { found: number } | undefined;
  return Boolean(row);
}

export function resetSourceEndpointHealth(endpointId: string) {
  const result = getDb()
    .prepare(
      `UPDATE source_endpoints
       SET endpoint_status = 'active', last_failure_at = NULL, consecutive_failures = 0,
           cooldown_until = NULL, last_error = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(Date.now(), endpointId);
  return result.changes > 0
    ? { ok: true }
    : { ok: false, error: 'SOURCE_ENDPOINT_NOT_FOUND' as const };
}

export function listRefreshEndpointsForFeed(feedId: string, params?: {
  includeCoolingDown?: boolean;
}) {
  syncSourceEndpointRecordsForFeed(feedId);
  const now = Date.now();
  const rows = getDb()
    .prepare(
      `SELECT
         se.id as endpointId,
         se.feed_id as feedId,
         se.source_id as sourceId,
         se.endpoint_role as endpointRole,
         se.provider_type as providerType,
         se.endpoint_url as endpointUrl,
         se.endpoint_host as endpointHost,
         se.endpoint_status as endpointStatus,
         se.cooldown_until as cooldownUntil,
         se.last_error as lastError,
         se.managed_by as managedBy,
         se.role_locked as roleLocked
       FROM source_endpoints se
       WHERE se.feed_id = ?
       ORDER BY
         CASE se.endpoint_role
           WHEN 'primary' THEN 0
           ELSE 1
         END,
         CASE
           WHEN se.endpoint_status = 'active' THEN 0
           WHEN se.cooldown_until IS NOT NULL AND se.cooldown_until > ? THEN 2
           ELSE 1
         END,
         COALESCE(se.last_success_at, 0) DESC,
         COALESCE(se.updated_at, 0) DESC`,
    )
    .all(feedId, now) as Array<Omit<RefreshEndpointCandidate, 'providerClass'>>;

  const enriched = rows.map((row) => ({
    ...row,
    providerClass: getProviderClass(row.providerType),
  })) satisfies RefreshEndpointCandidate[];

  if (params?.includeCoolingDown) {
    return enriched;
  }

  return enriched.filter((row) => !row.cooldownUntil || row.cooldownUntil <= now);
}

export function listFeedSyncStates(params?: {
  feedIds?: string[] | null;
}) {
  const database = getDb();
  const feedIds = (params?.feedIds ?? []).filter(Boolean);
  const placeholders = feedIds.map(() => '?').join(', ');
  const whereClause = feedIds.length > 0 ? `WHERE se.feed_id IN (${placeholders})` : '';
  const rows = database
    .prepare(
      `SELECT
         se.feed_id as feedId,
         COUNT(*) as totalEndpoints,
         SUM(CASE WHEN se.endpoint_status = 'active' THEN 1 ELSE 0 END) as activeEndpoints,
         SUM(CASE WHEN se.endpoint_status = 'degraded' THEN 1 ELSE 0 END) as degradedEndpoints,
         SUM(CASE WHEN se.endpoint_status = 'cooldown' THEN 1 ELSE 0 END) as cooldownEndpoints,
         SUM(CASE WHEN se.endpoint_role = 'fallback' THEN 1 ELSE 0 END) as fallbackEndpoints,
         MAX(se.last_success_at) as lastSuccessAt,
         MAX(se.last_failure_at) as lastFailureAt,
         (
           SELECT se2.last_error
           FROM source_endpoints se2
           WHERE se2.feed_id = se.feed_id AND se2.last_error IS NOT NULL
           ORDER BY COALESCE(se2.last_failure_at, 0) DESC, COALESCE(se2.updated_at, 0) DESC
           LIMIT 1
         ) as lastError
       FROM source_endpoints se
       ${whereClause}
       GROUP BY se.feed_id`,
    )
    .all(...feedIds) as Array<Omit<FeedSyncState, 'syncStatus'>>;

  return rows.map((row) => {
    let syncStatus: FeedSyncState['syncStatus'] = 'unknown';
    if (row.activeEndpoints > 0) {
      syncStatus = 'active';
    } else if (row.lastSuccessAt && (row.cooldownEndpoints > 0 || row.degradedEndpoints > 0)) {
      syncStatus = 'stale';
    } else if (row.cooldownEndpoints > 0) {
      syncStatus = 'cooldown';
    } else if (row.degradedEndpoints > 0) {
      syncStatus = 'degraded';
    }

    return {
      ...row,
      syncStatus,
    };
  }) satisfies FeedSyncState[];
}

export function listSourceEndpointHealth(params?: {
  status?: 'active' | 'degraded' | 'cooldown' | null;
  limit?: number | null;
}) {
  const database = getDb();
  const values: Array<string | number> = [];
  const conditions: string[] = [];

  if (params?.status) {
    conditions.push('se.endpoint_status = ?');
    values.push(params.status);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(200, Math.floor(params?.limit ?? 50)));
  const rows = database
    .prepare(
      `SELECT
         se.id as endpointId,
         se.feed_id as feedId,
         f.title as feedTitle,
         f.url as feedUrl,
         se.endpoint_role as endpointRole,
         se.provider_type as providerType,
         se.endpoint_url as endpointUrl,
         se.managed_by as managedBy,
         se.role_locked as roleLocked,
         se.endpoint_host as endpointHost,
         se.endpoint_status as endpointStatus,
         se.consecutive_failures as consecutiveFailures,
         se.cooldown_until as cooldownUntil,
         se.last_success_at as lastSuccessAt,
         se.last_failure_at as lastFailureAt,
         se.last_error as lastError
       FROM source_endpoints se
       JOIN feeds f ON f.id = se.feed_id
       ${whereClause}
       ORDER BY
         CASE se.endpoint_status
           WHEN 'cooldown' THEN 0
           WHEN 'degraded' THEN 1
           ELSE 2
         END,
         se.consecutive_failures DESC,
         COALESCE(se.last_failure_at, 0) DESC
       LIMIT ?`,
    )
    .all(...values, limit) as Array<Omit<SourceEndpointHealth, 'providerClass'>>;

  return rows.map((row) => ({
    ...row,
    providerClass: getProviderClass(row.providerType),
  })) satisfies SourceEndpointHealth[];
}

export function listFeedRunDiagnostics(params?: {
  status?: 'success' | 'failed' | 'not_modified' | 'cancelled' | null;
  providerClass?: 'native' | 'bridge' | 'adapter' | 'unknown' | null;
  limit?: number | null;
}) {
  const database = getDb();
  const values: Array<string | number> = [];
  const conditions: string[] = [];

  if (params?.status) {
    conditions.push('fr.status = ?');
    values.push(params.status);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(200, Math.floor(params?.limit ?? 50)));
  const rows = database
    .prepare(
      `SELECT
         fr.id as id,
         fr.pipeline_run_id as pipelineRunId,
         fr.feed_id as feedId,
         f.title as feedTitle,
         f.url as feedUrl,
         fr.run_type as runType,
         fr.trigger as trigger,
         fr.status as status,
         fr.provider_type as providerType,
         fr.endpoint_host as endpointHost,
         fr.not_modified as notModified,
         fr.new_entries as newEntries,
         fr.error as error,
         fr.finished_at as finishedAt
       FROM feed_run_results fr
       JOIN feeds f ON f.id = fr.feed_id
       ${whereClause}
       ORDER BY fr.finished_at DESC
       LIMIT ?`,
    )
    .all(...values, limit) as Array<Omit<FeedRunDiagnostic, 'providerClass'>>;

  const enriched = rows.map((row) => ({
    ...row,
    providerClass: getProviderClass(row.providerType),
  })) satisfies FeedRunDiagnostic[];

  if (!params?.providerClass) {
    return enriched;
  }
  return enriched.filter((row) => row.providerClass === params.providerClass);
}

export function summarizeSourceEndpointHealth(params?: { failureDomainLimit?: number | null }) {
  const database = getDb();
  const byProviderClass = createEmptyProviderHealthSummaryRecord();
  const counts = database
    .prepare(
      `SELECT
         provider_type as providerType,
         endpoint_status as endpointStatus,
         COUNT(*) as count
       FROM source_endpoints
       GROUP BY provider_type, endpoint_status`,
    )
    .all() as Array<{
    providerType: string | null;
    endpointStatus: 'active' | 'degraded' | 'cooldown';
    count: number;
  }>;

  let totalEndpoints = 0;
  for (const row of counts) {
    const providerClass = getProviderClass(row.providerType);
    const bucket = byProviderClass[providerClass];
    bucket.total += row.count;
    bucket[row.endpointStatus] += row.count;
    totalEndpoints += row.count;
  }

  const failureDomainLimit = Math.max(1, Math.min(20, Math.floor(params?.failureDomainLimit ?? 8)));
  const failureDomains = database
    .prepare(
      `SELECT
         COALESCE(endpoint_host, '(unknown)') as endpointHost,
         provider_type as providerType,
         COUNT(*) as affectedEndpoints,
         SUM(CASE WHEN endpoint_status = 'degraded' THEN 1 ELSE 0 END) as degradedEndpoints,
         SUM(CASE WHEN endpoint_status = 'cooldown' THEN 1 ELSE 0 END) as cooldownEndpoints,
         MAX(last_failure_at) as lastFailureAt
       FROM source_endpoints
       WHERE endpoint_status <> 'active'
       GROUP BY endpoint_host, provider_type
       ORDER BY
         SUM(CASE WHEN endpoint_status = 'cooldown' THEN 1 ELSE 0 END) DESC,
         SUM(CASE WHEN endpoint_status = 'degraded' THEN 1 ELSE 0 END) DESC,
         MAX(last_failure_at) DESC
       LIMIT ?`,
    )
    .all(failureDomainLimit)
    .map((row) => ({
      ...(row as {
        endpointHost: string;
        providerType: string | null;
        affectedEndpoints: number;
        degradedEndpoints: number;
        cooldownEndpoints: number;
        lastFailureAt: number | null;
      }),
      providerClass: getProviderClass((row as { providerType: string | null }).providerType),
    })) satisfies SourceEndpointHealthSummary['failureDomains'];

  return {
    totalEndpoints,
    byProviderClass,
    failureDomains,
  } satisfies SourceEndpointHealthSummary;
}

export function summarizeFeedFailures(params?: { windowHours?: number | null }) {
  const database = getDb();
  const windowHours = Math.max(1, Math.min(24 * 30, Math.floor(params?.windowHours ?? 24)));
  const windowStartAt = Date.now() - windowHours * 60 * 60 * 1000;
  const byProviderClass = createEmptyFailureSummaryRecord();
  const rows = database
    .prepare(
      `SELECT
         provider_type as providerType,
         COUNT(*) as count
       FROM feed_run_results
       WHERE status = 'failed' AND finished_at >= ?
       GROUP BY provider_type`,
    )
    .all(windowStartAt) as Array<{ providerType: string | null; count: number }>;

  let totalFailures = 0;
  for (const row of rows) {
    const providerClass = getProviderClass(row.providerType);
    byProviderClass[providerClass] += row.count;
    totalFailures += row.count;
  }

  return {
    windowHours,
    windowStartAt,
    totalFailures,
    byProviderClass,
  } satisfies FeedFailureSummary;
}
