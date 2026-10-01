import { isThemePreference, type ThemePreference } from '../contracts/appearance';
import { getDb } from './db-core';

const THEME_KEY = 'reader.appearance.theme';

export function getThemePreference(): ThemePreference {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(THEME_KEY) as
    { value: string } | undefined;
  return isThemePreference(row?.value) ? row.value : 'light';
}

export function saveThemePreference(preference: ThemePreference) {
  getDb().prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(THEME_KEY, preference, Date.now());
}
