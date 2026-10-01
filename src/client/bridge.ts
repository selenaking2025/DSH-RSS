import type { RssBridge } from '../../.generated/catpaw/electron/contracts/rss';
import { INVOKE_METHODS, EVENT_METHODS } from './methods.ts';
import { isRecord, errorMessage } from '../shared/protocol.ts';
export interface Rpc { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }> }
export function createBridge(rpc: Rpc) {
  const owner = crypto.randomUUID();
  const lifetime = new AbortController();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const statusListeners = new Set<(error: string) => void>();
  const reconnectListeners = new Set<() => void>();
  const themeListeners = new Set<(preference: string) => void>();
  let theme = 'system';
  let status = '';
  const setStatus = (value: string) => { status = value; for (const listener of statusListeners) listener(value); };
  async function request(method: string, args: unknown[] = []) {
    const values = [...args]; while (values.length && values.at(-1) === undefined) values.pop();
    const response = await rpc.call('/api', 'catpaw/invoke', { owner, method, args: values }, lifetime.signal);
    if (!response.ok) throw new Error(response.error.message);
    return response.value;
  }
  const api: Record<string, unknown> = Object.fromEntries(INVOKE_METHODS.map(method => [method, (...args: unknown[]) => request(method, args)]));
  for (const method of ['getThemePreference', 'setThemePreference']) api[method] = async (...args: unknown[]) => {
    const value = await request(method, args);
    if (value !== 'light' && value !== 'dark' && value !== 'system') throw new Error('外观设置无效。');
    theme = value; for (const listener of themeListeners) listener(theme); return value;
  };
  for (const [method, channel] of Object.entries(EVENT_METHODS)) api[method] = (listener: (value: unknown) => void) => {
    let set = listeners.get(channel); if (!set) listeners.set(channel, set = new Set());
    set.add(listener); return () => set.delete(listener);
  };
  let sequence = 0;
  async function poll() {
    let interrupted = false;
    while (!lifetime.signal.aborted) {
      try {
        const response = await rpc.call('/api', 'catpaw/invoke', { owner, method: 'events', after: sequence }, lifetime.signal);
        if (!response.ok) throw new Error(response.error.message);
        if (!isRecord(response.value) || typeof response.value.sequence !== 'number' || !Array.isArray(response.value.events)) throw new Error('后台通知格式无效。');
        if (response.value.connected === false) throw new Error('后台正在重新启动');
        sequence = response.value.sequence;
        if (response.value.reset) for (const listener of listeners.get('rss:stateChanged') ?? []) listener({ scopes: ['subscriptions', 'entries', 'counts', 'jobs'] });
        for (const event of response.value.events) if (isRecord(event) && typeof event.channel === 'string') {
          for (const listener of listeners.get(event.channel) ?? []) listener(event.value);
        }
        setStatus('');
        // Initial reads may have failed while the host was being enabled. Reload
        // all reader settings as well as article data after transport recovery.
        if (interrupted) { interrupted = false; for (const listener of reconnectListeners) listener(); }
      } catch (error) {
        if (lifetime.signal.aborted) break;
        interrupted = true;
        setStatus(`Catpaw 连接已中断：${errorMessage(error)}。正在重试…`);
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); lifetime.signal.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, 2000); lifetime.signal.addEventListener('abort', finish, { once: true });
        });
      }
    }
  }
  void poll();
  return { rss: api as RssBridge, request,
    onTheme(listener: (preference: string) => void) { themeListeners.add(listener); listener(theme); return () => { themeListeners.delete(listener); }; },
    onStatus(listener: (error: string) => void) { statusListeners.add(listener); listener(status); return () => { statusListeners.delete(listener); }; },
    onReconnect(listener: () => void) { reconnectListeners.add(listener); return () => { reconnectListeners.delete(listener); }; },
    dispose() { lifetime.abort(); listeners.clear(); statusListeners.clear(); reconnectListeners.clear(); themeListeners.clear(); void rpc.call('/api', 'catpaw/invoke', { owner, method: 'release' }).catch(() => {}); },
  };
}
