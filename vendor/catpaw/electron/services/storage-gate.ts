// The main process has synchronous repositories. A maintenance barrier queues
// their writes asynchronously while a child owns the database write lock.
let barrier: Promise<void> | null = null;
export function blockStorageWrites() {
  if (barrier) throw new Error('MAINTENANCE_ALREADY_RUNNING');
  let release!: () => void;
  barrier = new Promise<void>((resolve) => { release = resolve; });
  return () => { barrier = null; release(); };
}
export async function whenStorageAvailable<T>(task: () => T): Promise<Awaited<T>> {
  while (barrier) await barrier;
  return task() as Awaited<T>;
}
