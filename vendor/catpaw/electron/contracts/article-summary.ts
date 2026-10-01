import type { ModelSelection } from './model-providers';

export const SUMMARY_VERSION = 1;
export const SUMMARY_SOURCE_LIMIT = 240_000;
export type SummarySourceKind = 'content' | 'excerpt';
export type SummarySource = { title: string; text: string; sourceHash: string; sourceKind: SummarySourceKind };
export type PreparedSummarySource = { ok: true; source: SummarySource } | { ok: false; error: string };
export type ArticleSummary = {
  summary: string;
  sourceKind: SummarySourceKind;
  providerId: string;
  model: string;
  savedAt: number;
};
export type SummarizeArticleInput = { entryId: string; requestId: string; regenerate?: boolean; selection?: ModelSelection };
export type ArticleSummaryResult = { ok: true; analysis: ArticleSummary }
  | { ok: false; code: 'CANCELLED' | 'CONFIG_REQUIRED' | 'FAILED'; error: string };
export class SummaryError extends Error {
  constructor(message: string, public readonly code: 'FAILED' | 'CONFIG_REQUIRED' = 'FAILED') { super(message); }
}
