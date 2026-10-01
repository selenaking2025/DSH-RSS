import { whenStorageAvailable } from './storage-gate';
const SQLITE_BUSY_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 4_000];
function isSqliteBusyError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('database is locked') || message.includes('sqlite_busy');
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runWithSqliteBusyRetry<T>(label: string, task: () => T): Promise<Awaited<T>> {
  for (let attempt = 0; attempt <= SQLITE_BUSY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt === SQLITE_BUSY_RETRY_DELAYS_MS.length) {
        throw error;
      }
      console.warn(`[sqlite] ${label} hit busy lock, retrying`, {
        attempt: attempt + 1,
        delayMs: SQLITE_BUSY_RETRY_DELAYS_MS[attempt],
      });
      await delay(SQLITE_BUSY_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new Error(`SQLITE_BUSY_RETRY_EXHAUSTED:${label}`);
}

export function runWithStorageWriteRetry<T>(label: string, task: () => T) {
  return runWithSqliteBusyRetry(label, () => whenStorageAvailable(task));
}
