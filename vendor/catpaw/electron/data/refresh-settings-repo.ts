import { getDb } from './db-core';

const SCHEDULE_ENABLED_KEY = 'rss.schedule.enabled';
const SCHEDULE_DAILY_TIME_KEY = 'rss.schedule.daily_time';
const SCHEDULE_CATCH_UP_KEY = 'rss.schedule.catch_up_missed';
const SCHEDULE_LAST_SLOT_KEY = 'rss.schedule.last_slot_at';
const HISTORY_START_YEAR_KEY = 'rss.history.start_year';
const HISTORY_MAX_PAGES_KEY = 'rss.history.max_pages_per_feed';

export type RefreshSettings = {
  enabled: boolean;
  dailyTime: string;
  catchUpMissed: boolean;
  // How far back a history backfill is allowed to walk, and how many pages per
  // source it may spend getting there. Both used to be compile-time constants.
  historyStartYear: number;
  historyMaxPagesPerFeed: number;
};

const DEFAULT_SETTINGS: RefreshSettings = {
  enabled: true,
  dailyTime: '05:00',
  catchUpMissed: true,
  historyStartYear: 2023,
  historyMaxPagesPerFeed: 300,
};

const MIN_HISTORY_START_YEAR = 1990;
const MAX_HISTORY_MAX_PAGES_PER_FEED = 300;

export function isValidHistoryStartYear(value: number) {
  if (!Number.isInteger(value)) return false;
  return value >= MIN_HISTORY_START_YEAR && value <= new Date().getFullYear();
}

export function isValidHistoryMaxPagesPerFeed(value: number) {
  if (!Number.isInteger(value)) return false;
  return value >= 1 && value <= MAX_HISTORY_MAX_PAGES_PER_FEED;
}

export function parseDailyTime(value: string) {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function createDailySlotTimestamp(base: Date, dailyTime: string) {
  const parsed = parseDailyTime(dailyTime);
  if (!parsed) throw new Error('REFRESH_DAILY_TIME_INVALID');
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    parsed.hour,
    parsed.minute,
    0,
    0,
  ).getTime();
}

export function findNextDailyRefreshAt(afterTime: number, dailyTime: string) {
  const base = new Date(afterTime);
  const today = createDailySlotTimestamp(base, dailyTime);
  if (today > afterTime) return today;
  const tomorrow = new Date(base);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return createDailySlotTimestamp(tomorrow, dailyTime);
}

export function findMostRecentDailyRefreshAt(now: number, dailyTime: string) {
  const base = new Date(now);
  const today = createDailySlotTimestamp(base, dailyTime);
  if (today <= now) return today;
  const yesterday = new Date(base);
  yesterday.setDate(yesterday.getDate() - 1);
  return createDailySlotTimestamp(yesterday, dailyTime);
}

function readSettingsMap() {
  const rows = getDb()
    .prepare(
      `SELECT key, value
       FROM app_settings
       WHERE key IN (?, ?, ?, ?, ?, ?)`,
    )
    .all(
      SCHEDULE_ENABLED_KEY,
      SCHEDULE_DAILY_TIME_KEY,
      SCHEDULE_CATCH_UP_KEY,
      SCHEDULE_LAST_SLOT_KEY,
      HISTORY_START_YEAR_KEY,
      HISTORY_MAX_PAGES_KEY,
    ) as Array<{
    key: string;
    value: string;
  }>;
  return new Map(rows.map((row) => [row.key, row.value]));
}

function readIntegerSetting(values: Map<string, string>, key: string, fallback: number, isValid: (value: number) => boolean) {
  const raw = values.get(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return isValid(parsed) ? parsed : fallback;
}

export function getRefreshSettings(): RefreshSettings {
  const values = readSettingsMap();
  const dailyTime = values.get(SCHEDULE_DAILY_TIME_KEY) ?? DEFAULT_SETTINGS.dailyTime;
  return {
    enabled: (values.get(SCHEDULE_ENABLED_KEY) ?? '1') === '1',
    dailyTime: parseDailyTime(dailyTime) ? dailyTime : DEFAULT_SETTINGS.dailyTime,
    catchUpMissed: (values.get(SCHEDULE_CATCH_UP_KEY) ?? '1') === '1',
    historyStartYear: readIntegerSetting(
      values,
      HISTORY_START_YEAR_KEY,
      DEFAULT_SETTINGS.historyStartYear,
      isValidHistoryStartYear,
    ),
    historyMaxPagesPerFeed: readIntegerSetting(
      values,
      HISTORY_MAX_PAGES_KEY,
      DEFAULT_SETTINGS.historyMaxPagesPerFeed,
      isValidHistoryMaxPagesPerFeed,
    ),
  };
}

/** Timestamp a history backfill should not walk past, derived from the stored year. */
export function resolveHistoryBackfillStartAt() {
  return new Date(getRefreshSettings().historyStartYear, 0, 1).getTime();
}

function writeSetting(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, Date.now());
}

export function updateRefreshSettings(input: Partial<RefreshSettings>) {
  const current = getRefreshSettings();
  const next: RefreshSettings = {
    enabled: input.enabled ?? current.enabled,
    dailyTime: input.dailyTime ?? current.dailyTime,
    catchUpMissed: input.catchUpMissed ?? current.catchUpMissed,
    historyStartYear: input.historyStartYear ?? current.historyStartYear,
    historyMaxPagesPerFeed: input.historyMaxPagesPerFeed ?? current.historyMaxPagesPerFeed,
  };
  if (!parseDailyTime(next.dailyTime)) {
    return { ok: false, error: 'REFRESH_DAILY_TIME_INVALID' as const };
  }
  if (!isValidHistoryStartYear(next.historyStartYear)) {
    return { ok: false, error: 'REFRESH_HISTORY_START_YEAR_INVALID' as const };
  }
  if (!isValidHistoryMaxPagesPerFeed(next.historyMaxPagesPerFeed)) {
    return { ok: false, error: 'REFRESH_HISTORY_MAX_PAGES_INVALID' as const };
  }
  const database = getDb();
  const save = database.transaction(() => {
    writeSetting(SCHEDULE_ENABLED_KEY, next.enabled ? '1' : '0');
    writeSetting(SCHEDULE_DAILY_TIME_KEY, next.dailyTime);
    writeSetting(SCHEDULE_CATCH_UP_KEY, next.catchUpMissed ? '1' : '0');
    writeSetting(HISTORY_START_YEAR_KEY, String(next.historyStartYear));
    writeSetting(HISTORY_MAX_PAGES_KEY, String(next.historyMaxPagesPerFeed));
  });
  save();
  return { ok: true, settings: next };
}

export function getLastHandledDailySlotAt() {
  const value = readSettingsMap().get(SCHEDULE_LAST_SLOT_KEY);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function setLastHandledDailySlotAt(slotAt: number) {
  writeSetting(SCHEDULE_LAST_SLOT_KEY, String(Math.floor(slotAt)));
}

export function listDueIntervalFeedIds(now = Date.now()) {
  return (getDb()
    .prepare(
      `SELECT id
       FROM feeds
       WHERE enabled = 1
         AND fetch_interval_minutes IS NOT NULL
         AND next_refresh_at IS NOT NULL
         AND next_refresh_at <= ?
       ORDER BY next_refresh_at, id`,
    )
    .all(now) as Array<{ id: string }>).map((row) => row.id);
}

export function getNextIntervalRefreshAt() {
  const row = getDb()
    .prepare(
      `SELECT MIN(next_refresh_at) as nextRefreshAt
       FROM feeds
       WHERE enabled = 1
         AND fetch_interval_minutes IS NOT NULL
         AND next_refresh_at IS NOT NULL`,
    )
    .get() as { nextRefreshAt: number | null };
  return row.nextRefreshAt ?? null;
}

export function advanceIntervalFeedSchedules(feedIds: string[], fromTime = Date.now()) {
  if (feedIds.length === 0) return;
  const database = getDb();
  const readInterval = database.prepare('SELECT fetch_interval_minutes as intervalMinutes FROM feeds WHERE id = ?');
  const update = database.prepare('UPDATE feeds SET next_refresh_at = ? WHERE id = ?');
  const advance = database.transaction(() => {
    for (const feedId of feedIds) {
      const row = readInterval.get(feedId) as { intervalMinutes: number | null } | undefined;
      if (!row?.intervalMinutes) continue;
      update.run(fromTime + row.intervalMinutes * 60_000, feedId);
    }
  });
  advance();
}
