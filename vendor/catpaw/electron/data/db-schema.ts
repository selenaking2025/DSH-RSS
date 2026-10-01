import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const ON_MY_MAC_DEFAULT_GROUPS = ['AI资讯', '财经资讯', 'AI论文'] as const;
const PODCAST_FEED_REPLACEMENTS = [
  {
    title: 'The AI Daily Brief',
    fromUrls: [
      'https://anchor.fm/s/f7cac464/podcast/rss',
      'https://rsshub.app/youtube/playlist/PLRYSuzHGhXPmKnOpd-f588cNNmTe2S9FP',
    ],
    toUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCKelCK4ZaO6HeEI1KQjqzWA',
    toSiteUrl: 'https://www.youtube.com/channel/UCKelCK4ZaO6HeEI1KQjqzWA',
  },
  {
    title: 'Behind the Craft',
    fromUrls: [
      'https://anchor.fm/s/f38497cc/podcast/rss',
      'https://rsshub.app/youtube/playlist/PLIWHjbvRtljj4RewVNv_znkUe-3E-NKd2',
    ],
    toUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCnpBg7yqNauHtlNSpOl5-cg',
    toSiteUrl: 'https://www.youtube.com/channel/UCnpBg7yqNauHtlNSpOl5-cg',
  },
  {
    title: 'Minus One',
    fromUrls: [
      'https://anchor.fm/s/f91eac68/podcast/rss',
      'https://rsshub.app/youtube/playlist/PLmYVYFmFwGm3txxUduawn7i53C5rDjjd7',
    ],
    toUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCMR-rPSUI34DRQXUkvFuIUQ',
    toSiteUrl: 'https://www.youtube.com/channel/UCMR-rPSUI34DRQXUkvFuIUQ',
  },
  {
    title: 'Lightcone Podcast',
    fromUrls: [
      'https://anchor.fm/s/f58d3330/podcast/rss',
      'https://rsshub.app/youtube/playlist/PLQ-uHSnFig5Ob4XXhgSK26Smb4oRhzFmK',
    ],
    toUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCcefcZRL2oaA_uBNeo5UOWg',
    toSiteUrl: 'https://www.youtube.com/channel/UCcefcZRL2oaA_uBNeo5UOWg',
  },
] as const;
const LEGACY_X_FEED_HOSTS = ['rsshub.app', 'bestblogs.dev'] as const;

type SchemaMigration = {
  version: number;
  apply: (database: Database.Database) => void;
};

function execIfNeeded(database: Database.Database, sql: string) {
  const column = sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/i);
  if (column) {
    const columns = database.pragma(`table_info(${column[1]})`) as Array<{ name: string }>;
    if (columns.some((item) => item.name === column[2])) return;
  }
  // Only a confirmed existing column is a no-op. I/O, lock and constraint errors abort.
  database.exec(sql);
}

function replaceKnownBrokenPodcastFeeds(database: Database.Database) {
  const findFeed = database.prepare(
    `SELECT id, url
     FROM feeds
     WHERE title = ?
     LIMIT 1`,
  );
  const findFeedByUrl = database.prepare(
    `SELECT id
     FROM feeds
     WHERE url = ?
     LIMIT 1`,
  );
  const updateFeed = database.prepare(
    `UPDATE feeds
     SET url = ?, site_url = ?, content_type = NULL, source_type = 'youtube-native',
         last_checked_at = NULL, last_modified = NULL, etag = NULL,
         content_hash = NULL, conditional_get_at = NULL, history_synced_at = NULL
     WHERE id = ?`,
  );
  const deleteRunResults = database.prepare('DELETE FROM feed_run_results WHERE feed_id = ?');
  const deleteSourceEndpoints = database.prepare('DELETE FROM source_endpoints WHERE feed_id = ?');

  for (const replacement of PODCAST_FEED_REPLACEMENTS) {
    const existing = findFeed.get(replacement.title) as { id: string; url: string } | undefined;
    if (!existing || !replacement.fromUrls.some((url) => url === existing.url)) continue;

    const duplicate = findFeedByUrl.get(replacement.toUrl) as { id: string } | undefined;
    if (duplicate && duplicate.id !== existing.id) continue;

    updateFeed.run(replacement.toUrl, replacement.toSiteUrl, existing.id);
    deleteRunResults.run(existing.id);
    deleteSourceEndpoints.run(existing.id);
  }
}

function extractLegacyXUsername(feedUrl: string | null | undefined) {
  if (!feedUrl) return null;
  try {
    const parsed = new URL(feedUrl);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (!LEGACY_X_FEED_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
      return null;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0]?.toLowerCase() !== 'twitter' || segments[1]?.toLowerCase() !== 'user' || !segments[2]) {
      return null;
    }
    return decodeURIComponent(segments[2]);
  } catch {
    return null;
  }
}

function buildOpenRssXFeedUrl(username: string) {
  return `https://openrss.org/twitter.com/${encodeURIComponent(username)}`;
}

function buildCanonicalXSiteUrl(username: string) {
  return `https://x.com/${encodeURIComponent(username)}`;
}

function replaceLegacyXFeeds(database: Database.Database) {
  const legacyFeeds = database
    .prepare(
      `SELECT id, url
       FROM feeds
       WHERE url LIKE 'https://rsshub.app/twitter/user/%'
          OR url LIKE 'https://www.rsshub.app/twitter/user/%'
          OR url LIKE 'https://bestblogs.dev/twitter/user/%'
          OR url LIKE 'https://www.bestblogs.dev/twitter/user/%'`,
    )
    .all() as Array<{ id: string; url: string }>;

  if (!legacyFeeds.length) return;

  const findFeedByUrl = database.prepare(
    `SELECT id
     FROM feeds
     WHERE url = ?
     LIMIT 1`,
  );
  const updateFeed = database.prepare(
    `UPDATE feeds
     SET url = ?, site_url = ?, content_type = 'social', source_type = 'native-rss',
         last_checked_at = NULL, last_modified = NULL, etag = NULL,
         content_hash = NULL, conditional_get_at = NULL, history_synced_at = NULL
     WHERE id = ?`,
  );
  const deleteRunResults = database.prepare('DELETE FROM feed_run_results WHERE feed_id = ?');
  const deleteSourceEndpoints = database.prepare('DELETE FROM source_endpoints WHERE feed_id = ?');

  for (const feed of legacyFeeds) {
    const username = extractLegacyXUsername(feed.url);
    if (!username) continue;

    const nextUrl = buildOpenRssXFeedUrl(username);
    const duplicate = findFeedByUrl.get(nextUrl) as { id: string } | undefined;
    if (duplicate && duplicate.id !== feed.id) continue;

    updateFeed.run(nextUrl, buildCanonicalXSiteUrl(username), feed.id);
    deleteRunResults.run(feed.id);
    deleteSourceEndpoints.run(feed.id);
  }
}

const migrations: SchemaMigration[] = [
  {
    version: 1,
    apply(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS feed_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          parent_id TEXT REFERENCES feed_groups(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS feeds (
          id TEXT PRIMARY KEY,
          title TEXT,
          url TEXT NOT NULL UNIQUE,
          site_url TEXT,
          group_id TEXT REFERENCES feed_groups(id) ON DELETE SET NULL,
          content_type TEXT,
          source_type TEXT,
          history_synced_at INTEGER,
          last_checked_at INTEGER,
          last_modified TEXT,
          etag TEXT,
          content_hash TEXT,
          conditional_get_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY,
          feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
          guid TEXT,
          title TEXT,
          link TEXT,
          author TEXT,
          published_at INTEGER,
          summary TEXT,
          content_html TEXT,
          content_text TEXT,
          content_fetch_status TEXT,
          content_fetched_at INTEGER,
          content_fetch_attempted_at INTEGER,
          content_fetch_error TEXT,
          fingerprint TEXT,
          media_url TEXT,
          media_type TEXT,
          is_read INTEGER DEFAULT 0,
          is_starred INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          UNIQUE(feed_id, guid),
          UNIQUE(feed_id, link)
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
          entry_id UNINDEXED,
          title,
          summary,
          content_text
        );

        CREATE TABLE IF NOT EXISTS pipeline_runs (
          id TEXT PRIMARY KEY,
          run_type TEXT NOT NULL,
          trigger TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          total_feeds INTEGER NOT NULL DEFAULT 0,
          feeds_completed INTEGER NOT NULL DEFAULT 0,
          feeds_succeeded INTEGER NOT NULL DEFAULT 0,
          feeds_failed INTEGER NOT NULL DEFAULT 0,
          new_entries INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          metadata_json TEXT
        );
      `);
    },
  },
  {
    version: 2,
    apply(database) {
      execIfNeeded(database, 'ALTER TABLE entries ADD COLUMN fingerprint TEXT');
      execIfNeeded(database, 'ALTER TABLE feeds ADD COLUMN content_hash TEXT');
      execIfNeeded(database, 'ALTER TABLE feeds ADD COLUMN content_type TEXT');
      execIfNeeded(database, 'ALTER TABLE feeds ADD COLUMN source_type TEXT');
      execIfNeeded(database, 'ALTER TABLE feeds ADD COLUMN conditional_get_at INTEGER');
      execIfNeeded(database, 'ALTER TABLE feeds ADD COLUMN history_synced_at INTEGER');
      execIfNeeded(database, 'ALTER TABLE entries ADD COLUMN media_url TEXT');
      execIfNeeded(database, 'ALTER TABLE entries ADD COLUMN media_type TEXT');
      execIfNeeded(database, 'ALTER TABLE entries ADD COLUMN content_fetch_status TEXT');
      execIfNeeded(database, 'ALTER TABLE entries ADD COLUMN content_fetched_at INTEGER');
      execIfNeeded(database, 'ALTER TABLE entries ADD COLUMN content_fetch_attempted_at INTEGER');
      execIfNeeded(database, 'ALTER TABLE entries ADD COLUMN content_fetch_error TEXT');
    },
  },
  {
    version: 3,
    apply(database) {
      execIfNeeded(
        database,
        'CREATE UNIQUE INDEX IF NOT EXISTS entries_feed_fingerprint ON entries(feed_id, fingerprint) WHERE fingerprint IS NOT NULL',
      );
      execIfNeeded(
        database,
        'CREATE INDEX IF NOT EXISTS entries_feed_recency_idx ON entries(feed_id, COALESCE(published_at, created_at) DESC, created_at DESC)',
      );
      execIfNeeded(
        database,
        'CREATE INDEX IF NOT EXISTS entries_unread_recency_idx ON entries(is_read, COALESCE(published_at, created_at) DESC, created_at DESC)',
      );
      execIfNeeded(
        database,
        'CREATE INDEX IF NOT EXISTS entries_unread_feed_idx ON entries(feed_id) WHERE is_read = 0',
      );
      execIfNeeded(
        database,
        'CREATE INDEX IF NOT EXISTS entries_starred_recency_idx ON entries(is_starred, COALESCE(published_at, created_at) DESC, created_at DESC)',
      );
    },
  },
  {
    version: 4,
    apply(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS sources (
          id TEXT PRIMARY KEY,
          feed_id TEXT NOT NULL UNIQUE REFERENCES feeds(id) ON DELETE CASCADE,
          title TEXT,
          source_kind TEXT NOT NULL DEFAULT 'feed',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS source_endpoints (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
          feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
          endpoint_role TEXT NOT NULL,
          provider_type TEXT NOT NULL,
          endpoint_url TEXT NOT NULL,
          endpoint_host TEXT,
          endpoint_status TEXT NOT NULL DEFAULT 'active',
          last_success_at INTEGER,
          last_failure_at INTEGER,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          cooldown_until INTEGER,
          last_error TEXT,
          capabilities_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS feed_run_results (
          id TEXT PRIMARY KEY,
          pipeline_run_id TEXT REFERENCES pipeline_runs(id) ON DELETE SET NULL,
          feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
          source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
          endpoint_id TEXT REFERENCES source_endpoints(id) ON DELETE SET NULL,
          run_type TEXT NOT NULL,
          trigger TEXT NOT NULL,
          status TEXT NOT NULL,
          provider_type TEXT,
          endpoint_host TEXT,
          not_modified INTEGER NOT NULL DEFAULT 0,
          new_entries INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          started_at INTEGER NOT NULL,
          finished_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      execIfNeeded(
        database,
        `CREATE UNIQUE INDEX IF NOT EXISTS source_endpoints_primary_per_feed
         ON source_endpoints(feed_id)
         WHERE endpoint_role = 'primary'`,
      );
      execIfNeeded(
        database,
        `CREATE INDEX IF NOT EXISTS source_endpoints_provider_status_idx
         ON source_endpoints(provider_type, endpoint_status, cooldown_until)`,
      );
      execIfNeeded(
        database,
        `CREATE INDEX IF NOT EXISTS feed_run_results_run_idx
         ON feed_run_results(pipeline_run_id, run_type, status, finished_at DESC)`,
      );
      execIfNeeded(
        database,
        `CREATE INDEX IF NOT EXISTS feed_run_results_feed_idx
         ON feed_run_results(feed_id, finished_at DESC)`,
      );
    },
  },
  {
    version: 5,
    apply() {
      // Version retained so existing Catpaw databases do not replay later migrations.
    },
  },
  {
    version: 6,
    apply(database) {
      replaceKnownBrokenPodcastFeeds(database);
    },
  },
  {
    version: 7,
    apply(database) {
      replaceKnownBrokenPodcastFeeds(database);
    },
  },
  {
    version: 8,
    apply(database) {
      replaceKnownBrokenPodcastFeeds(database);
    },
  },
  {
    version: 9,
    apply(database) {
      replaceLegacyXFeeds(database);
    },
  },
  {
    version: 10,
    apply() {
      // Version retained for database compatibility.
    },
  },
  {
    version: 11,
    apply() {
      // Version retained for database compatibility.
    },
  },
  {
    version: 12,
    apply(database) {
      // The per-feed unread-count query (getFeedUnreadCounts) and unread-by-feed
      // lookups previously fell back to the recency index + a temp B-tree, scanning
      // every unread row (~785ms on a 25k-entry / 668MB database). A composite index
      // on (is_read, feed_id) is covering for `SELECT feed_id, COUNT(*) ... WHERE
      // is_read = 0 GROUP BY feed_id`, dropping it to ~2ms. The older partial index
      // from migration v3 was created via execIfNeeded and was missing on some
      // databases (failures were swallowed); use a plain exec here so a creation
      // failure rolls the migration back and retries next launch instead of being
      // silently lost.
      database.exec(
        'CREATE INDEX IF NOT EXISTS entries_unread_feed_count_idx ON entries(is_read, feed_id)',
      );
    },
  },
  {
    version: 13,
    apply(database) {
      database.exec("ALTER TABLE source_endpoints ADD COLUMN managed_by TEXT NOT NULL DEFAULT 'system'");
      database.exec('ALTER TABLE source_endpoints ADD COLUMN role_locked INTEGER NOT NULL DEFAULT 0');
      database.exec(
        'CREATE INDEX IF NOT EXISTS source_endpoints_management_idx ON source_endpoints(feed_id, managed_by, role_locked)',
      );
    },
  },
  {
    version: 14,
    apply(database) {
      database.exec('ALTER TABLE feeds ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
      database.exec('ALTER TABLE feeds ADD COLUMN fetch_interval_minutes INTEGER');
      database.exec('ALTER TABLE feeds ADD COLUMN next_refresh_at INTEGER');
      database.exec(
        'CREATE INDEX IF NOT EXISTS feeds_scheduled_refresh_idx ON feeds(enabled, next_refresh_at) WHERE fetch_interval_minutes IS NOT NULL',
      );
    },
  },
  {
    version: 15,
    apply(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
    },
  },
  {
    version: 16,
    apply(database) {
      database.pragma('application_id = 0x43505731');
      database.exec(`
        DELETE FROM entries_fts;
        INSERT INTO entries_fts(rowid, entry_id, title, summary, content_text)
        SELECT rowid, id, COALESCE(title, ''), COALESCE(summary, ''), COALESCE(content_text, '') FROM entries;
        CREATE TRIGGER IF NOT EXISTS entries_remove_search AFTER DELETE ON entries BEGIN
          DELETE FROM entries_fts WHERE rowid = old.rowid;
        END;
        CREATE INDEX IF NOT EXISTS entries_cursor_idx ON entries(COALESCE(published_at, created_at) DESC, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS entries_feed_cursor_idx ON entries(feed_id, COALESCE(published_at, created_at) DESC, created_at DESC, id DESC);
      `);
    },
  },
  {
    version: 17,
    apply(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS article_translations (
          entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
          source_hash TEXT NOT NULL,
          target_language TEXT NOT NULL CHECK(target_language IN ('zh-CN', 'en')),
          provider_id TEXT NOT NULL,
          model TEXT NOT NULL,
          translated_texts TEXT NOT NULL CHECK(json_valid(translated_texts)),
          saved_at INTEGER NOT NULL,
          PRIMARY KEY (entry_id, source_hash, target_language, provider_id, model)
        );
      `);
    },
  },
  {
    version: 18,
    apply(database) {
      const columns = database.pragma('table_info(feeds)') as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'sync_revision')) {
        database.exec('ALTER TABLE feeds ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 0');
      }
      database.exec(`
        CREATE TRIGGER IF NOT EXISTS feeds_advance_sync_revision
        AFTER UPDATE OF url, site_url ON feeds
        WHEN OLD.url IS NOT NEW.url OR OLD.site_url IS NOT NEW.site_url
        BEGIN
          UPDATE feeds SET sync_revision = OLD.sync_revision + 1 WHERE id = NEW.id;
        END;
      `);
    },
  },
  {
    version: 19,
    apply(database) {
      const columns = database.pragma('table_info(feeds)') as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'fetch_meta_url')) {
        // Old validators have no known owner and will be ignored until a full fetch.
        database.exec('ALTER TABLE feeds ADD COLUMN fetch_meta_url TEXT');
      }
    },
  },
  {
    version: 20,
    apply(database) {
      database.exec(`CREATE TABLE article_summaries (
        entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
        source_hash TEXT NOT NULL, summary TEXT NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('content', 'excerpt')),
        provider_id TEXT NOT NULL, model TEXT NOT NULL, saved_at INTEGER NOT NULL
      )`);
    },
  },
  {
    version: 21,
    apply(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS feed_source_policies (
          feed_id TEXT PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
          source_url TEXT NOT NULL, site_url TEXT,
          strategy TEXT NOT NULL CHECK(strategy IN ('rss', 'html-listing', 'twitter'))
        );
        -- Freeze existing choices once, including X sources whose optional tool
        -- was unavailable. Folder names have no role after this migration.
        INSERT OR IGNORE INTO feed_source_policies (feed_id, source_url, site_url, strategy)
        SELECT f.id, f.url, f.site_url,
          CASE WHEN e.provider_type = 'html-article-listing' THEN 'html-listing'
            WHEN e.provider_type = 'web-cli-twitter' OR
              (pg.name = 'AtlasNews' AND g.name IN ('AI X Following Batch 1', 'AI tech news')) THEN 'twitter'
            ELSE 'rss' END
        FROM feeds f LEFT JOIN source_endpoints e ON e.feed_id = f.id AND e.endpoint_role = 'primary'
          LEFT JOIN feed_groups g ON g.id = f.group_id
          LEFT JOIN feed_groups pg ON pg.id = g.parent_id;
      `);
    },
  },
];

migrations.push({ version: 22, apply(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS reading_focuses (
      id TEXT PRIMARY KEY, revision INTEGER NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL,
      prefer TEXT NOT NULL, avoid TEXT NOT NULL, feed_ids TEXT NOT NULL, group_ids TEXT NOT NULL,
      priority INTEGER NOT NULL, expires_at INTEGER, enabled INTEGER NOT NULL, archived INTEGER NOT NULL,
      ephemeral INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reading_scores (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      focus_id TEXT NOT NULL REFERENCES reading_focuses(id) ON DELETE CASCADE,
      focus_revision INTEGER NOT NULL, source_hash TEXT NOT NULL, feed_revision INTEGER NOT NULL,
      model TEXT NOT NULL, rule_version INTEGER NOT NULL, assessment TEXT NOT NULL, saved_at INTEGER NOT NULL,
      PRIMARY KEY(entry_id, focus_id)
    );
    CREATE INDEX IF NOT EXISTS reading_scores_focus_time ON reading_scores(focus_id, saved_at);
    CREATE TABLE IF NOT EXISTS reading_feedback (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      focus_id TEXT NOT NULL REFERENCES reading_focuses(id) ON DELETE CASCADE,
      value TEXT NOT NULL CHECK(value IN ('useful', 'irrelevant', 'known')), saved_at INTEGER NOT NULL,
      PRIMARY KEY(entry_id, focus_id)
    );
    CREATE TABLE IF NOT EXISTS reading_history (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, source_hash TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('opened', 'known')), title TEXT NOT NULL, excerpt TEXT NOT NULL,
      occurred_at INTEGER NOT NULL, PRIMARY KEY(entry_id, kind)
    );
    CREATE INDEX IF NOT EXISTS reading_history_time ON reading_history(occurred_at);
    CREATE TABLE IF NOT EXISTS reading_relations (
      left_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      right_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      left_hash TEXT NOT NULL, right_hash TEXT NOT NULL, model TEXT NOT NULL, rule_version INTEGER NOT NULL,
      same_event INTEGER NOT NULL, confidence REAL NOT NULL, overridden INTEGER NOT NULL DEFAULT 0,
      saved_at INTEGER NOT NULL, PRIMARY KEY(left_id, right_id)
    );
    CREATE TABLE IF NOT EXISTS reading_progress (
      entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE, source_hash TEXT NOT NULL,
      previous_entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, previous_hash TEXT NOT NULL,
      model TEXT NOT NULL, rule_version INTEGER NOT NULL, result TEXT NOT NULL, saved_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reading_usage (day TEXT PRIMARY KEY, input_tokens INTEGER NOT NULL, requests INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reading_comparison_contexts (
      entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE, source_hash TEXT NOT NULL,
      model TEXT NOT NULL, rule_version INTEGER NOT NULL, event_context TEXT NOT NULL, history_context TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS reading_content_changed AFTER UPDATE OF title, summary, content_text, content_html, content_fetch_status, feed_id ON entries
    WHEN OLD.title IS NOT NEW.title OR OLD.summary IS NOT NEW.summary OR OLD.content_text IS NOT NEW.content_text
      OR OLD.content_html IS NOT NEW.content_html OR OLD.content_fetch_status IS NOT NEW.content_fetch_status OR OLD.feed_id IS NOT NEW.feed_id
    BEGIN
      DELETE FROM reading_scores WHERE entry_id = NEW.id;
      DELETE FROM reading_relations WHERE left_id = NEW.id OR right_id = NEW.id;
      DELETE FROM reading_comparison_contexts WHERE entry_id IN (SELECT entry_id FROM reading_progress WHERE previous_entry_id = NEW.id);
      DELETE FROM reading_progress WHERE entry_id = NEW.id OR previous_entry_id = NEW.id;
      DELETE FROM reading_comparison_contexts WHERE entry_id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS reading_source_changed AFTER UPDATE OF sync_revision ON feeds WHEN OLD.sync_revision IS NOT NEW.sync_revision
    BEGIN
      DELETE FROM reading_scores WHERE entry_id IN (SELECT id FROM entries WHERE feed_id = NEW.id);
      DELETE FROM reading_relations WHERE left_id IN (SELECT id FROM entries WHERE feed_id = NEW.id)
        OR right_id IN (SELECT id FROM entries WHERE feed_id = NEW.id);
      DELETE FROM reading_comparison_contexts WHERE entry_id IN (SELECT entry_id FROM reading_progress WHERE previous_entry_id IN (SELECT id FROM entries WHERE feed_id = NEW.id));
      DELETE FROM reading_progress WHERE entry_id IN (SELECT id FROM entries WHERE feed_id = NEW.id)
        OR previous_entry_id IN (SELECT id FROM entries WHERE feed_id = NEW.id);
      DELETE FROM reading_comparison_contexts WHERE entry_id IN (SELECT id FROM entries WHERE feed_id = NEW.id);
    END;
  `);
} });
export const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1].version;

export function initSchema(database: Database.Database) {
  const currentVersion = database.pragma('user_version', { simple: true }) as number;
  if (currentVersion > CURRENT_SCHEMA_VERSION) throw new Error('DATABASE_REQUIRES_NEWER_APP');

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;

    const runMigration = database.transaction(() => {
      if ((database.pragma('user_version', { simple: true }) as number) >= migration.version) return;
      migration.apply(database);
      database.pragma(`user_version = ${migration.version}`);
    });
    runMigration.immediate();
  }
}

export function ensureDefaultOnMyMacGroups(database: Database.Database) {
  const existingRows = database
    .prepare(
      `SELECT id, name
       FROM feed_groups
       WHERE parent_id IS NULL AND name IN (${ON_MY_MAC_DEFAULT_GROUPS.map(() => '?').join(',')})`,
    )
    .all(...ON_MY_MAC_DEFAULT_GROUPS) as Array<{ id: string; name: string }>;
  const byName = new Map(existingRows.map((row) => [row.name, row.id]));
  const insertGroup = database.prepare('INSERT INTO feed_groups (id, name, parent_id) VALUES (?, ?, NULL)');

  for (const groupName of ON_MY_MAC_DEFAULT_GROUPS) {
    if (byName.has(groupName)) continue;
    const id = randomUUID();
    insertGroup.run(id, groupName);
    byName.set(groupName, id);
  }

}
