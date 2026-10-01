import type { FeedFailureKind } from './contracts/feed-run';

export class FeedError extends Error {
  constructor(readonly kind: FeedFailureKind, message: string) { super(message); this.name = 'FeedError'; }
}

/** Preserve local control/storage failures before adapters turn errors into text. */
export function classifyFeedError(error: unknown): FeedFailureKind {
  if (error instanceof FeedError) return error.kind;
  const value = error as { message?: string; code?: string; name?: string } | null;
  const message = `${value?.code ?? ''} ${value?.message ?? String(error)}`;
  if (/\b(?:REQUEST_CANCELLED|CANCELLED|BROWSER_CANCELLED)\b/.test(message)) return 'cancelled';
  if (message.includes('FEED_CHANGED_DURING_SYNC')) return 'source-changed';
  if (value?.name === 'SqliteError' || /\bSQLITE_[A-Z_]+\b/.test(message)) return 'storage';
  if (/REQUEST_BUDGET_EXHAUSTED|WORKER_|FEED_NOT_FOUND|RUN_INCOMPLETE/.test(message)) return 'internal';
  if (/timeout|timed out|DEADLINE_EXCEEDED/i.test(message)) return 'timeout';
  return 'provider';
}

/** Classify only at the external boundary; a supplied category always wins. */
export function feedFailure(error: unknown, kind = classifyFeedError(error)) {
  return { ok: false as const, error: error instanceof Error ? error.message : String(error),
    errorKind: kind, cancelled: kind === 'cancelled' };
}

export function affectsEndpointHealth(kind: FeedFailureKind | undefined) {
  return kind === undefined || kind === 'provider' || kind === 'timeout';
}
