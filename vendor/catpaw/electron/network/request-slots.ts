import { recordMetric } from '../diagnostics/performance';
import { randomUUID } from 'node:crypto';
import { networkRequests, networkSlot } from './request-broker';
import type { BackgroundJobPriority } from '../contracts/background-jobs';

const pending = new Map<string, (error?: Error) => void>();
function receive(message: { type?: string; id?: string; error?: string }) {
  if (message?.type === 'network:granted' && message.id) pending.get(message.id)?.(message.error ? new Error(message.error) : undefined);
}
function disconnected() { for (const finish of [...pending.values()]) finish(new Error('REQUEST_HOST_DISCONNECTED')); }
async function acquireSlot(url: string, signal: AbortSignal, limit = 1, priority: BackgroundJobPriority = 'interactive') {
  if (!process.send || process.env.CATPAW_REQUEST_BROKER !== '1') return networkRequests.acquire(networkSlot(url, limit, priority), signal);
  if (signal.aborted) throw signal.reason;
  const id = randomUUID();
  const release = () => { if (process.connected) process.send?.({ type: 'network:release', id }, () => {}); };
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      if (!pending.delete(id)) return;
      signal.removeEventListener('abort', abort);
      if (!pending.size) { process.off('message', receive); process.off('disconnect', disconnected); }
      if (error) { release(); reject(error); } else resolve();
    };
    const abort = () => finish(signal.reason ?? new Error('REQUEST_CANCELLED'));
    if (!pending.size) { process.on('message', receive); process.once('disconnect', disconnected); }
    pending.set(id, finish);
    signal.addEventListener('abort', abort, { once: true });
    process.send!({ type: 'network:acquire', id, url, limit, priority }, (error: Error | null) => { if (error) finish(error); });
  });
  if (signal.aborted) { release(); throw signal.reason; }
  return release;
}

export async function acquireNetworkSlot(url: string, signal: AbortSignal, limit = 1, priority: BackgroundJobPriority = 'interactive') {
  const started = performance.now();
  try { return await acquireSlot(url, signal, limit, priority); }
  finally { recordMetric('network.wait', performance.now() - started); }
}
