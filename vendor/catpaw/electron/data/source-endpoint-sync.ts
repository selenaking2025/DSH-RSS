import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  buildEndpointCapabilitiesJson,
  getEndpointFailurePolicy,
  getEndpointHost,
  inferEndpointProviderType,
  isRetryableFeedRunError,
} from '../sources/endpoint-utils';
import { buildDesiredListingEndpoints, type FeedSnapshot } from '../sources/endpoint-plan';
import { readSourceCapabilities } from './source-capabilities-repo';
import type { SourceCapabilities } from '../contracts/source-capabilities';
import { readSourceStrategy, saveSourceStrategy } from './source-policy-repo';

type SyncedSourceEndpoint = {
  sourceId: string;
  endpointId: string;
  providerType: string;
  endpointHost: string | null;
};

function readFeedSnapshot(database: Database.Database, feedId: string) {
  return database
    .prepare(
      `SELECT
         f.id as id,
         f.title as title,
         f.url as url,
         f.site_url as siteUrl,
         f.content_type as contentType,
         f.source_type as sourceType
       FROM feeds f
       WHERE f.id = ?`,
    )
    .get(feedId) as FeedSnapshot | undefined;
}


function ensureSourceRecord(database: Database.Database, feed: FeedSnapshot) {
  const now = Date.now();
  const existingSource = database
    .prepare('SELECT id FROM sources WHERE feed_id = ?')
    .get(feed.id) as { id: string } | undefined;
  const sourceId = existingSource?.id ?? randomUUID();

  if (existingSource) {
    database
      .prepare(
        `UPDATE sources
         SET title = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(feed.title ?? null, now, sourceId);
  } else {
    database
      .prepare(
        `INSERT INTO sources (id, feed_id, title, source_kind, created_at, updated_at)
         VALUES (?, ?, ?, 'feed', ?, ?)`,
      )
      .run(sourceId, feed.id, feed.title ?? null, now, now);
  }

  return sourceId;
}

function upsertSourceEndpoint(
  database: Database.Database,
  input: {
    feed: FeedSnapshot;
    sourceId: string;
    endpointRole: 'primary' | 'fallback';
    endpointUrl: string;
    providerType?: string | null;
    managedBy?: 'system' | 'user';
    roleLocked?: boolean;
  },
): SyncedSourceEndpoint {
  const now = Date.now();
  const providerType = input.providerType ?? inferEndpointProviderType({
    sourceType: input.feed.sourceType,
    url: input.endpointUrl,
  });
  const endpointHost = getEndpointHost(input.endpointUrl);
  const managedBy = input.managedBy ?? 'system';
  const roleLocked = input.roleLocked ? 1 : 0;
  const capabilitiesJson = buildEndpointCapabilitiesJson({
    providerType,
    contentType: input.feed.contentType,
  });
  const existingEndpoint = database
    .prepare(
      input.endpointRole === 'primary'
        ? `SELECT id, provider_type as providerType, endpoint_url as endpointUrl,
                  endpoint_host as endpointHost, managed_by as managedBy, role_locked as roleLocked
           FROM source_endpoints
           WHERE feed_id = ? AND endpoint_role = 'primary'
           LIMIT 1`
        : `SELECT id, provider_type as providerType, endpoint_url as endpointUrl,
                  endpoint_host as endpointHost, managed_by as managedBy, role_locked as roleLocked
           FROM source_endpoints
           WHERE feed_id = ? AND endpoint_role = 'fallback' AND endpoint_url = ?
           LIMIT 1`,
    )
    .get(
      ...(input.endpointRole === 'primary'
        ? [input.feed.id]
        : [input.feed.id, input.endpointUrl]),
    ) as {
      id: string;
      providerType: string;
      endpointUrl: string;
      endpointHost: string | null;
      managedBy: 'system' | 'user';
      roleLocked: number;
    } | undefined;
  const endpointId = existingEndpoint?.id ?? randomUUID();

  if (existingEndpoint) {
    if (managedBy === 'system' && (existingEndpoint.managedBy === 'user' || existingEndpoint.roleLocked === 1)) {
      return {
        sourceId: input.sourceId,
        endpointId,
        providerType: existingEndpoint.providerType,
        endpointHost: existingEndpoint.endpointHost,
      };
    }
    const endpointChanged = existingEndpoint.providerType !== providerType || existingEndpoint.endpointUrl !== input.endpointUrl;
    if (endpointChanged) {
      database
        .prepare(
          `UPDATE source_endpoints
           SET source_id = ?, provider_type = ?, endpoint_url = ?, endpoint_host = ?, capabilities_json = ?,
               managed_by = ?, role_locked = ?, endpoint_status = 'active', last_success_at = NULL,
               last_failure_at = NULL, consecutive_failures = 0, cooldown_until = NULL, last_error = NULL,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(input.sourceId, providerType, input.endpointUrl, endpointHost, capabilitiesJson, managedBy, roleLocked, now, endpointId);
    } else {
      database
        .prepare(
          `UPDATE source_endpoints
           SET source_id = ?, capabilities_json = ?, managed_by = ?, role_locked = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.sourceId, capabilitiesJson, managedBy, roleLocked, now, endpointId);
    }
  } else {
    database
      .prepare(
        `INSERT INTO source_endpoints (
           id, source_id, feed_id, endpoint_role, provider_type, endpoint_url, endpoint_host,
           endpoint_status, capabilities_json, managed_by, role_locked, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      )
      .run(
        endpointId,
        input.sourceId,
        input.feed.id,
        input.endpointRole,
        providerType,
        input.endpointUrl,
        endpointHost,
        capabilitiesJson,
        managedBy,
        roleLocked,
        now,
        now,
      );
  }

  return {
    sourceId: input.sourceId,
    endpointId,
    providerType,
    endpointHost,
  };
}

function syncSourceEndpointForFeed(database: Database.Database, feed: FeedSnapshot, capabilities: SourceCapabilities) {
  feed = { ...feed, sourceStrategy: readSourceStrategy(database, feed) };
  saveSourceStrategy(database, { ...feed, sourceStrategy: feed.sourceStrategy! });
  const sourceId = ensureSourceRecord(database, feed);
  const desiredEndpoints = buildDesiredListingEndpoints(feed, capabilities);
  let primary: SyncedSourceEndpoint | null = null;
  for (const endpoint of desiredEndpoints) {
    const synced = upsertSourceEndpoint(database, {
      feed,
      sourceId,
      endpointRole: endpoint.endpointRole,
      endpointUrl: endpoint.endpointUrl,
      providerType: endpoint.providerType,
    });
    if (endpoint.endpointRole === 'primary') {
      primary = synced;
    }
  }

  const fallbackKeepUrls = desiredEndpoints
    .filter((endpoint) => endpoint.endpointRole === 'fallback')
    .map((endpoint) => endpoint.endpointUrl);

  if (fallbackKeepUrls.length > 0) {
    const placeholders = fallbackKeepUrls.map(() => '?').join(', ');
    database
      .prepare(
        `DELETE FROM source_endpoints
         WHERE feed_id = ?
           AND endpoint_role = 'fallback'
           AND managed_by = 'system'
           AND role_locked = 0
           AND endpoint_url NOT IN (${placeholders})`,
      )
      .run(feed.id, ...fallbackKeepUrls);
  } else {
    database
      .prepare(
        `DELETE FROM source_endpoints
         WHERE feed_id = ?
           AND endpoint_role = 'fallback'
           AND managed_by = 'system'
           AND role_locked = 0`,
      )
      .run(feed.id);
  }

  return primary;
}

export function listSourceFeedSnapshots(database: Database.Database) {
  const feeds = database
    .prepare(
      `SELECT
         f.id as id,
         f.title as title,
         f.url as url,
         f.site_url as siteUrl,
         f.content_type as contentType,
         f.source_type as sourceType
       FROM feeds f`,
    )
    .all() as FeedSnapshot[];
  return feeds.map((feed) => ({ ...feed, sourceStrategy: readSourceStrategy(database, feed) }));
}

export function ensureSourceEndpointSeedData(database: Database.Database, capabilities = readSourceCapabilities(database)) {
  const run = database.transaction(() => {
    for (const feed of listSourceFeedSnapshots(database)) {
      syncSourceEndpointForFeed(database, feed, capabilities);
    }
  });
  run();
}

export function syncSourceEndpointForFeedById(database: Database.Database, feedId: string) {
  const feed = readFeedSnapshot(database, feedId);
  if (!feed) return null;
  return syncSourceEndpointForFeed(database, feed, readSourceCapabilities(database));
}

export function upsertSourceEndpointForFeed(database: Database.Database, input: {
  feedId: string;
  endpointRole: 'primary' | 'fallback';
  endpointUrl: string;
  providerType?: string | null;
  managedBy?: 'system' | 'user';
  roleLocked?: boolean;
}) {
  const feed = readFeedSnapshot(database, input.feedId);
  if (!feed) return null;
  const sourceId = ensureSourceRecord(database, feed);
  return upsertSourceEndpoint(database, {
    feed,
    sourceId,
    endpointRole: input.endpointRole,
    endpointUrl: input.endpointUrl,
    providerType: input.providerType,
    managedBy: input.managedBy,
    roleLocked: input.roleLocked,
  });
}

function resolveSourceEndpointForRun(database: Database.Database, input: {
  feedId: string;
  endpointId?: string | null;
}) {
  if (input.endpointId) {
    const endpoint = database
      .prepare(
        `SELECT
           source_id as sourceId,
           id as endpointId,
           provider_type as providerType,
           endpoint_host as endpointHost
         FROM source_endpoints
         WHERE id = ?
         LIMIT 1`,
      )
      .get(input.endpointId) as SyncedSourceEndpoint | undefined;
    if (endpoint) {
      return endpoint;
    }
  }

  return syncSourceEndpointForFeedById(database, input.feedId);
}

export function recordFeedRunResult(database: Database.Database, input: {
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
  // Set false for outcomes that describe the feed rather than an endpoint (e.g. the
  // synthetic SOURCE_ENDPOINTS_COOLDOWN emitted when every endpoint is already
  // cooling). The run is still recorded for diagnostics, but endpoint health,
  // failure counters and last_error are left alone.
  affectsEndpointHealth?: boolean;
}) {
  const synced = resolveSourceEndpointForRun(database, {
    feedId: input.feedId,
    endpointId: input.endpointId,
  });
  if (!synced) return null;

  const resultId = randomUUID();
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO feed_run_results (
         id, pipeline_run_id, feed_id, source_id, endpoint_id, run_type, trigger, status,
         provider_type, endpoint_host, not_modified, new_entries, error,
         started_at, finished_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      resultId,
      input.pipelineRunId,
      input.feedId,
      synced.sourceId,
      synced.endpointId,
      input.runType,
      input.trigger,
      input.status,
      synced.providerType,
      synced.endpointHost,
      input.notModified ? 1 : 0,
      input.newEntries ?? 0,
      input.error ?? null,
      input.startedAt,
      input.finishedAt,
      now,
    );

  if (input.affectsEndpointHealth === false || input.status === 'cancelled') {
    return {
      id: resultId,
      ...synced,
    };
  }

  const existingHealth = database
    .prepare(
      `SELECT consecutive_failures as consecutiveFailures, cooldown_until as cooldownUntil
       FROM source_endpoints
       WHERE id = ?`,
    )
    .get(synced.endpointId) as { consecutiveFailures: number; cooldownUntil: number | null } | undefined;
  const currentFailures = existingHealth?.consecutiveFailures ?? 0;
  const currentCooldownUntil = existingHealth?.cooldownUntil ?? null;

  if (input.status === 'failed') {
    const nextFailures = currentFailures + 1;
    const retryable = isRetryableFeedRunError(input.error ?? null);
    const failurePolicy = getEndpointFailurePolicy(synced.providerType);
    const armedCooldownUntil = retryable && nextFailures >= failurePolicy.failureThreshold
      ? input.finishedAt + failurePolicy.cooldownMs
      : null;
    // A failure never releases a cooldown that is still in effect. Writing NULL
    // here used to hand a cooling endpoint straight back to the next refresh
    // whenever the newest error happened to be non-retryable, which capped every
    // cooldown at a single refresh cycle.
    const unexpiredCooldownUntil = currentCooldownUntil && currentCooldownUntil > input.finishedAt
      ? currentCooldownUntil
      : null;
    const nextCooldownUntil = Math.max(armedCooldownUntil ?? 0, unexpiredCooldownUntil ?? 0) || null;
    database
      .prepare(
        `UPDATE source_endpoints
         SET endpoint_status = ?, last_failure_at = ?, consecutive_failures = ?, cooldown_until = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        nextCooldownUntil ? 'cooldown' : 'degraded',
        input.finishedAt,
        nextFailures,
        nextCooldownUntil,
        input.error ?? null,
        input.finishedAt,
        synced.endpointId,
      );
  } else {
    database
      .prepare(
        `UPDATE source_endpoints
         SET endpoint_status = 'active', last_success_at = ?, consecutive_failures = 0,
             cooldown_until = NULL, last_error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.finishedAt, input.finishedAt, synced.endpointId);
  }

  return {
    id: resultId,
    ...synced,
  };
}
