import { useReaderQuery } from './useReaderQuery';
import type { EnrichmentQueueStatus } from './rss-types';
export function useEnrichmentQueueStatus(options?: { enabled?: boolean; intervalMs?: number }) {
  const result = useReaderQuery<EnrichmentQueueStatus | null>('getEnrichmentQueueStatus', async () => (await window.catpaw!.rss.getEnrichmentQueueStatus()), null, options?.enabled ?? true);
  return { enrichmentQueueStatus: result.data, loading: result.loading, error: result.error };
}
