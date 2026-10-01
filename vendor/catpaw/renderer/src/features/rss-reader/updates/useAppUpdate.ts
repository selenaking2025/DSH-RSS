import { useRef, useState, useSyncExternalStore } from 'react';
import type { AppUpdateAction, AppUpdateStatus } from '../../../../../electron/contracts/app-update';
import { useRequestScope } from '../useRequestScope';

let status: AppUpdateStatus | null = null;
let dispose: (() => void) | undefined;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    let active = true;
    const receive = (next: AppUpdateStatus) => {
      if (!active || (status && next.revision < status.revision)) return;
      status = next;
      for (const notify of listeners) notify();
    };
    const api = window.catpaw?.rss;
    const unsubscribe = api?.onUpdateStatusChanged(receive);
    void api?.getUpdateStatus().then(receive).catch(() => receive({ revision: 0, phase: 'error', currentVersion: '',
      message: '无法读取更新状态，请重新打开应用后重试。', retry: 'check' }));
    dispose = () => { active = false; unsubscribe?.(); status = null; };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { dispose?.(); dispose = undefined; }
  };
}
const snapshot = () => status;
export const useAppUpdate = () => useSyncExternalStore(subscribe, snapshot);

export function useAppUpdateAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const beginRequest = useRequestScope('app-update-action');
  const run = async (action: AppUpdateAction) => {
    if (running.current) return;
    running.current = true;
    const current = beginRequest();
    setPending(true); setError('');
    try {
      const api = window.catpaw!.rss;
      const result = await ({ check: api.checkForUpdates, download: api.downloadUpdate, install: api.installUpdate })[action]();
      if (current() && !result.ok) setError(result.error ?? '更新未完成，请重试。');
    } catch { if (current()) setError('无法完成更新操作，请稍后重试。'); }
    finally { running.current = false; if (current()) setPending(false); }
  };
  return { pending, error, run };
}
