import { useReaderQuery } from './useReaderQuery';
import type { PipelineRunsResult } from './rss-types';
export function usePipelineRuns(options?: { enabled?: boolean; intervalMs?: number; limit?: number; runType?: 'refresh' | 'backfill' | null }) {
  const { enabled = true, limit = 20, runType = null } = options ?? {};
  const result = useReaderQuery<PipelineRunsResult>(`runs:${runType}:${limit}`, () => window.catpaw!.rss.listPipelineRuns({ limit, runType }), [], enabled);
  return { runs: result.data, loading: result.loading, error: result.error };
}
