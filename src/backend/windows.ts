import { BrowserWindow } from 'electron';
import type { BackendMessage } from '../shared/protocol.ts';

const windows = new Map<string, BrowserWindow>();
const touched = new Map<string, number>();
export function touchOwner(owner: string) { if (windows.has(owner)) touched.set(owner, Date.now()); }
export function reapOwners(active: ReadonlySet<string>) {
  for (const [owner, time] of touched) if (owner !== 'broadcast' && !active.has(owner) && Date.now() - time > 10 * 60_000) closeOwner(owner);
}
export function send(message: BackendMessage) {
  if (process.connected) process.send?.(message);
}

/** Hidden local owners provide real Electron dialog and cancellation lifetimes. */
export function ownerWindow(owner = 'broadcast'): BrowserWindow {
  const existing = windows.get(owner);
  if (existing && !existing.isDestroyed()) { touchOwner(owner); return existing; }
  if (windows.size >= 32) throw new Error('TOO_MANY_CATPAW_CLIENTS');
  const window = new BrowserWindow({ show: false, width: 900, height: 700,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  // These windows own no renderer application: send means a private IPC event to the parent.
  window.webContents.send = (channel: string, value: unknown) => send({ kind: 'event', channel, value,
    ...(owner === 'broadcast' ? {} : { owner }) });
  window.on('closed', () => { windows.delete(owner); touched.delete(owner); });
  windows.set(owner, window);
  touched.set(owner, Date.now());
  return window;
}

export const getMainWindow = () => ownerWindow();
export const getRendererUrl = () => 'about:blank';
export function closeOwner(owner: string) { windows.get(owner)?.destroy(); }
export function closeWindows() { for (const window of [...windows.values()]) window.destroy(); }
