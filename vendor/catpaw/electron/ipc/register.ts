import { recordMetric } from '../diagnostics/performance';
import { ipcMain as electronIpc } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { getMainWindow, getRendererUrl } from '../desktop-window';
import { validateSender } from '../security/renderer-policy';
import { validateIpcInput, rssInputRules } from '../security/ipc-input';
import type { RssBridge, RssInvokeMethod, RssResult } from '../contracts/rss';
import type { ReaderStateChange } from '../contracts/reader-events';
import { whenStorageAvailable } from '../services/storage-gate';
import { isShuttingDown } from '../services/shutdown-state';

const mainThreadWrites = new Set<RssInvokeMethod>(['markRead', 'markAllRead', 'toggleStar', 'createGroup', 'updateGroup', 'deleteGroup',
  'updateFeed', 'deleteFeed', 'updateRefreshSettings', 'setXApiFallbackEnabled', 'resetSourceEndpointHealth', 'cancelActiveJobs', 'setThemePreference']);

const dataMutations: Partial<Record<RssInvokeMethod, ReaderStateChange['scopes']>> = {
  markRead: ['counts'], markAllRead: ['counts', 'entries'], toggleStar: ['counts', 'entries'],
  fetchEntryContent: ['entries'], resolveXiaoyuzhouAudio: ['entries'],
  addFeed: ['subscriptions', 'entries', 'counts'], updateFeed: ['subscriptions', 'entries', 'counts'],
  deleteFeed: ['subscriptions', 'entries', 'counts'], importOpml: ['subscriptions', 'entries', 'counts'],
  createGroup: ['subscriptions'], updateGroup: ['subscriptions'], deleteGroup: ['subscriptions'],
  rebuildSearchIndex: ['entries'],
};

export function notifyReaderStateChanged(scopes: ReaderStateChange['scopes'] = ['jobs']) {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) window.webContents.send('rss:stateChanged', { scopes } satisfies ReaderStateChange);
}

export const ipcMain = {
  handle<K extends RssInvokeMethod>(
    channel: `rss:${K}`,
    handler: (event: IpcMainInvokeEvent, ...args: Parameters<RssBridge[NoInfer<K>]>) => RssResult<NoInfer<K>> | Promise<RssResult<NoInfer<K>>>,
  ) {
    electronIpc.handle(channel, async (event, ...args) => {
      validateSender(event, getMainWindow(), getRendererUrl());
      validateIpcInput(channel, args);
      if (isShuttingDown() && channel !== 'rss:getUpdateStatus') throw new Error('APP_QUITTING');
      const started = performance.now();
      try {
        const invoke = () => {
          if (isShuttingDown() && channel !== 'rss:getUpdateStatus') throw new Error('APP_QUITTING');
          return handler(event, ...(args as Parameters<RssBridge[K]>));
        };
        const result = await (mainThreadWrites.has(channel.slice(4) as K) ? whenStorageAvailable(invoke) : invoke());
        if (rssInputRules[channel.slice(4) as K].changesState) notifyReaderStateChanged(dataMutations[channel.slice(4) as K]);
        return result;
      } finally { recordMetric('ipc', performance.now() - started); }
    });
  },
};
