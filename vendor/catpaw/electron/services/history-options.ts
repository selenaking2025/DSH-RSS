import { getRefreshSettings, resolveHistoryBackfillStartAt } from '../data/refresh-settings-repo';
/**
 * Fills in the user's configured history depth for any backfill option the caller
 * left unset. Both bounds used to be compile-time constants with no way to reach
 * anything older than 2023.
 */
export function withHistoryDepthDefaults<T extends { since?: number | null; maxPages?: number | null; maxPagesPerFeed?: number | null }>(
  options?: T,
) {
  const settings = getRefreshSettings();
  return {
    ...(options ?? ({} as T)),
    since: options?.since ?? resolveHistoryBackfillStartAt(),
    maxPages: options?.maxPages ?? settings.historyMaxPagesPerFeed,
    maxPagesPerFeed: options?.maxPagesPerFeed ?? settings.historyMaxPagesPerFeed,
  };
}
