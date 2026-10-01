import type { ChildProcess } from 'node:child_process';
import { BACKGROUND_JOB_PRIORITY_WEIGHT } from '../contracts/background-jobs';
import { RequestScheduler, type RequestSlot } from './request-scheduler';

export const networkRequests = new RequestScheduler();
const owners = new Map<string, { controller: AbortController; release?: () => void }>();
export function networkSlot(url: string, limit = 1, priority: RequestSlot['priority'] = 'interactive'): RequestSlot {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('UNSUPPORTED_URL_PROTOCOL');
  if (!Number.isInteger(limit) || limit < 1 || limit > 2 || !Object.prototype.hasOwnProperty.call(BACKGROUND_JOB_PRIORITY_WEIGHT, priority)) throw new Error('INVALID_REQUEST_SLOT');
  return { key: target.hostname.toLowerCase(), limit, priority };
}
function releaseOwner(key: string) {
  const owned = owners.get(key);
  if (!owned) return;
  owners.delete(key); owned.controller.abort(); owned.release?.();
}
export function releaseNetworkOwner(pid: number | undefined) {
  for (const key of owners.keys()) if (key.startsWith(`${pid}:`)) releaseOwner(key);
}
export function handleNetworkMessage(worker: ChildProcess, input: unknown) {
  const message = input as { type?: string; id?: string; url?: string; limit?: number; priority?: RequestSlot['priority'] };
  if (!message?.type?.startsWith('network:')) return false;
  if (typeof message.id !== 'string' || message.id.length > 100) throw new Error('INVALID_NETWORK_MESSAGE');
  const key = `${worker.pid}:${message.id}`;
  if (message.type === 'network:release') { releaseOwner(key); return true; }
  if (message.type !== 'network:acquire' || owners.has(key) || typeof message.url !== 'string') throw new Error('INVALID_NETWORK_MESSAGE');
  const slot = networkSlot(message.url, message.limit, message.priority);
  const owned: { controller: AbortController; release?: () => void } = { controller: new AbortController() };
  owners.set(key, owned);
  void networkRequests.acquire(slot, owned.controller.signal).then((release) => {
    owned.release = release;
    if (!owners.has(key) || !worker.connected || worker.killed) { release(); releaseOwner(key); return; }
    worker.send({ type: 'network:granted', id: message.id }, (error) => { if (error) releaseOwner(key); });
  }, (error: Error) => {
    releaseOwner(key);
    if (worker.connected && !worker.killed) worker.send({ type: 'network:granted', id: message.id, error: error.message }, () => {});
  });
  return true;
}
