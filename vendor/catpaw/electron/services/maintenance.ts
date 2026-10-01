import { maintenanceJobManager } from '../maintenance-job-manager';
import { rssJobManager } from '../rss-job-manager';
import { readerJobManager } from '../reader-job-manager';
import { blockStorageWrites } from './storage-gate';
import { smartReading } from './smart-reading';
import type { MaintenanceInputs, MaintenanceKind, MaintenanceStatus } from '../contracts/maintenance';

let waiting: MaintenanceStatus | null = null;
let tail: Promise<unknown> = Promise.resolve();
export const getMaintenanceStatus = () => maintenanceJobManager.getStatus() ?? waiting;
export function runMaintenance<K extends MaintenanceKind>(kind: K, input: MaintenanceInputs[K], keepPaused = false) {
  const run = async () => {
    const reading = smartReading.pause();
    const rss = rssJobManager.pause(), reader = readerJobManager.pause();
    let release: (() => void) | undefined;
    waiting = { kind, phase: 'waiting', completed: 0, total: 0 };
    let completed = false;
    try {
      await Promise.all([reading.drained, rss.drained, reader.drained]);
      // A running fetch may still need cancellation while maintenance waits.
      // Block main-process writes only once the child can take the write lock.
      release = blockStorageWrites();
      const result = await maintenanceJobManager.run(kind, input);
      completed = true;
      return result;
    } finally {
      waiting = null;
      if (!completed || !keepPaused) { release?.(); rss.resume(); reader.resume(); reading.resume(); }
    }
  };
  const result = tail.then(run);
  tail = result.catch(() => {});
  return result;
}
