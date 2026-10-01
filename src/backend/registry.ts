import type { WebContents } from 'electron';
import { validateIpcInput, rssInputRules } from '../../.generated/catpaw/electron/security/ipc-input';
import { whenStorageAvailable } from '../../.generated/catpaw/electron/services/storage-gate';
import { isShuttingDown } from '../../.generated/catpaw/electron/services/shutdown-state';
import type { RssBridge, RssInvokeMethod, RssResult } from '../../.generated/catpaw/electron/contracts/rss';
import type { ReaderStateChange } from '../../.generated/catpaw/electron/contracts/reader-events';
import { send } from './windows.ts';

type Event = { sender: WebContents };
type Handler = (event: Event, args: unknown[]) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const writes = new Set(['markRead', 'markAllRead', 'toggleStar', 'createGroup', 'updateGroup', 'deleteGroup',
  'updateFeed', 'deleteFeed', 'updateRefreshSettings', 'setXApiFallbackEnabled', 'resetSourceEndpointHealth', 'setThemePreference']);
const scopes: Record<string, ReaderStateChange['scopes']> = {
  markRead: ['counts'], markAllRead: ['counts', 'entries'], toggleStar: ['counts', 'entries'],
  fetchEntryContent: ['entries'], resolveXiaoyuzhouAudio: ['entries'],
  addFeed: ['subscriptions', 'entries', 'counts'], updateFeed: ['subscriptions', 'entries', 'counts'],
  deleteFeed: ['subscriptions', 'entries', 'counts'], importOpml: ['subscriptions', 'entries', 'counts'],
  createGroup: ['subscriptions'], updateGroup: ['subscriptions'], deleteGroup: ['subscriptions'], rebuildSearchIndex: ['entries'],
};
export function notifyReaderStateChanged(changed: ReaderStateChange['scopes'] = ['jobs']) {
  send({ kind: 'event', channel: 'rss:stateChanged', value: { scopes: changed } });
}
export const ipcMain = {
  handle<K extends RssInvokeMethod>(channel: `rss:${K}`,
    handler: (event: Event, ...args: Parameters<RssBridge[NoInfer<K>]>) => RssResult<NoInfer<K>> | Promise<RssResult<NoInfer<K>>>) {
    if (handlers.has(channel)) throw new Error(`Duplicate Catpaw method: ${channel}`);
    handlers.set(channel, async (event, args) => {
      validateIpcInput(channel, args);
      if (isShuttingDown()) throw new Error('CATPAW_STOPPING');
      const method = channel.slice(4) as K;
      const run = () => handler(event, ...args as Parameters<RssBridge[K]>);
      const result = await (writes.has(method) ? whenStorageAvailable(run) : run());
      if (rssInputRules[method].changesState) notifyReaderStateChanged(scopes[method]);
      return result;
    });
  },
};
export const methods = () => [...handlers.keys()].map(key => key.slice(4));
export function registerExtra(method: string, handler: Handler) {
  if (handlers.has(`rss:${method}`)) throw new Error(`Duplicate Catpaw method: ${method}`);
  handlers.set(`rss:${method}`, async (event, args) => {
    if (isShuttingDown()) throw new Error('CATPAW_STOPPING');
    return handler(event, args);
  });
}
export function invoke(method: string, args: unknown[], sender: WebContents) {
  const handler = handlers.get(`rss:${method}`);
  if (!handler) throw new Error(`UNKNOWN_CATPAW_METHOD:${method}`);
  return handler({ sender }, args);
}
