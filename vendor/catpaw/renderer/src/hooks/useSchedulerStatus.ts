import { useReaderQuery } from './useReaderQuery';
import type { SchedulerStatus } from './rss-types';
export function useSchedulerStatus(options?: { enabled?: boolean; intervalMs?: number }) {
  const result = useReaderQuery<SchedulerStatus | null>('getSchedulerStatus', async () => (await window.catpaw!.rss.getSchedulerStatus()), null, options?.enabled ?? true);
  return { schedulerStatus: result.data, loading: result.loading, error: result.error };
}
