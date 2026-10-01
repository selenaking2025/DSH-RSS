import type { BackgroundJobFailure, BackgroundJobPriority } from './background-jobs';

import type { ReaderJobKind, ReaderJobResults } from './reader-jobs';
export type { ReaderJobKind } from './reader-jobs';

export type ReaderWorkerRequest = {
  requestId: string;
  kind: ReaderJobKind;
  entryId: string;
  userDataDir?: string | null;
  priority?: BackgroundJobPriority;
};

export type ReaderWorkerReadyMessage = {
  type: 'ready';
};

export type ReaderWorkerResultMessage = {
  type: 'result';
  payload: {
    requestId: string;
    kind: ReaderJobKind;
    payload?: ReaderJobResults[ReaderJobKind];
    error?: string;
  };
};

export type ReaderWorkerLogMessage = {
  type: 'log';
  payload: {
    level: 'info' | 'warn' | 'error';
    message: string;
  };
};

export type ReaderWorkerMessage =
  | ReaderWorkerReadyMessage
  | ReaderWorkerResultMessage
  | ReaderWorkerLogMessage;

export type ReaderJobStatus = {
  currentJob: {
    requestId: string;
    kind: ReaderJobKind;
    entryId: string;
    enqueuedAt: number;
    startedAt: number;
  } | null;
  queueDepth: number;
  inflightCount: number;
  queuedByKind: Record<ReaderJobKind, number>;
  lastFailure: BackgroundJobFailure | null;
};
