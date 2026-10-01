export type FeedFailureKind = 'cancelled' | 'timeout' | 'provider' | 'storage' | 'source-changed' | 'internal';

export type FeedRunResult = {
  ok: boolean;
  error?: string;
  errorKind?: FeedFailureKind;
  cancelled?: boolean;
  historyEnd?: 'end' | 'limit' | 'boundary';
  pages?: number;
  scannedItems?: number;
  reachedBoundary?: boolean;
  historyCapable?: boolean;
  notModified?: boolean;
  newEntries?: number;
};

export type BatchFeedRunResult = FeedRunResult & { id: string; url: string };

export type RunFailure = { error: string; errorKind: FeedFailureKind };
export type RunProgress = { total: number; done: number; succeeded: number; failed: number; newEntries: number };
export type RssRunOutcome = {
  runId: string | null;
  progress: RunProgress;
  feeds: BatchFeedRunResult[];
} & (
  | { status: 'completed'; failure?: never }
  | { status: 'failed' | 'cancelled'; failure: RunFailure }
);
