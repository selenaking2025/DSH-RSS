import { BrowserWindow, dialog } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ipcMain } from './register';
import { getMainWindow } from '../desktop-window';
import { exportOpml } from '../services/opml';
import { runMaintenance } from '../services/maintenance';
import { deleteFeed } from '../data/feed-write-repo';
import { countEntries, getFeedUnreadCounts } from '../data/entry-read-repo';
import { getEntry, listEntries, markEntryRead, markAllEntriesRead, toggleEntryStar } from '../data/entry-repo';
import { listFeedEnrichmentStates } from '../data/feed-enrichment-repo';
import { createGroup, deleteGroup, listFeeds, listGroups, updateGroup } from '../data/feed-repo';
import { listPipelineRuns } from '../data/pipeline-run-repo';
import { hasUserSourceEndpoint, listFeedRunDiagnostics, listFeedSyncStates, listSourceEndpointHealth,
  removeUserSourceEndpointsForFeed, resetSourceEndpointHealth, upsertSourceEndpointRecord } from '../data/source-endpoint-repo';
import { addSubscription, updateSubscription } from '../services/subscriptions';
import { openWeChatLogin } from '../providers/reader';
import { discoverFeeds } from '../providers/feed-discovery';
import { getRefreshSettings, updateRefreshSettings } from '../data/refresh-settings-repo';
import { buildXApiTwitterEndpointUrl, getXApiBearerTokenFilePath, isXApiTwitterEnabled, resolveXApiTwitterHandle } from '../providers/x-api-twitter';
import { readerJobManager } from '../reader-job-manager';
import { getPlaywrightProfileDir } from '../runtime';
import { rssJobManager } from '../rss-job-manager';
import type { RssBatchJobOptions } from '../contracts/rss-jobs';
import { enqueueBackfillAll, enqueueBackfillFeed, enqueueRefreshAll, enqueueRefreshFeed, toRunOutcome, failedRun } from '../services/rss-run-service';
import { withHistoryDepthDefaults } from '../services/history-options';
import { runWithSqliteBusyRetry, runWithStorageWriteRetry } from '../services/sqlite-retry';
import { scheduleNextScheduledRefresh, runDueScheduledRefreshes } from '../services/scheduler';
const pendingOpmlPreviews = new Map<string, { xml: string; filePath: string; createdAt: number }>();
const OPML_PREVIEW_TTL_MS = 15 * 60 * 1000;
const X_API_PROVIDER_TYPE = 'x-api-twitter';
function getXApiFallbackStatus(feedId: string) {
  const feed = listFeeds().find((item) => item.id === feedId);
  if (!feed) return { ok: false, error: 'FEED_NOT_FOUND' as const };
  const handle = resolveXApiTwitterHandle({ siteUrl: feed.siteUrl, url: feed.url });
  return {
    ok: true,
    configured: isXApiTwitterEnabled(),
    eligible: Boolean(handle),
    enabled: hasUserSourceEndpoint(feedId, X_API_PROVIDER_TYPE),
    handle,
    tokenFilePath: getXApiBearerTokenFilePath(),
  };
}

export function registerRssHandlers() {
  ipcMain.handle('rss:listGroups', async () => {
    return await runWithSqliteBusyRetry('listGroups', () => listGroups());
  });
  ipcMain.handle('rss:listFeeds', async () => {
    return await runWithSqliteBusyRetry('listFeeds', () => listFeeds());
  });
  ipcMain.handle('rss:listEntries', async (_event, params) => {
    return await runWithSqliteBusyRetry('listEntries', () => listEntries(params));
  });
  ipcMain.handle('rss:getEntry', async (_event, id: string) => {
    return await runWithSqliteBusyRetry('getEntry', () => getEntry(id));
  });
  ipcMain.handle('rss:getUnreadCounts', async () => {
    return await runWithSqliteBusyRetry('getUnreadCounts', () => getFeedUnreadCounts());
  });
  ipcMain.handle('rss:markRead', async (_event, id: string, isRead: boolean) => {
    return await runWithStorageWriteRetry('markRead', () => markEntryRead(id, isRead));
  });
  ipcMain.handle('rss:markAllRead', async (_event, feedId) => {
    return await runWithStorageWriteRetry('markAllRead', () => markAllEntriesRead(feedId));
  });
  ipcMain.handle('rss:toggleStar', async (_event, id: string) => {
    return await runWithStorageWriteRetry('toggleStar', () => toggleEntryStar(id));
  });
  ipcMain.handle('rss:countEntries', async (_event, params) => {
    return await runWithSqliteBusyRetry('countEntries', () => countEntries(params ?? {}));
  });
  ipcMain.handle('rss:cancelActiveJobs', () => rssJobManager.cancelActiveJobs());
  ipcMain.handle('rss:getSchedulerStatus', async () => {
    return await runWithSqliteBusyRetry('getSchedulerStatus', () => rssJobManager.getStatus());
  });
  ipcMain.handle('rss:getRefreshSettings', async () => {
    return await runWithSqliteBusyRetry('getRefreshSettings', () => getRefreshSettings());
  });
  ipcMain.handle('rss:updateRefreshSettings', async (_event, input) => {
    const result = await runWithStorageWriteRetry('updateRefreshSettings', () => updateRefreshSettings(input ?? {}));
    if (result.ok) {
      scheduleNextScheduledRefresh();
      void runDueScheduledRefreshes('settings_update');
    }
    return result;
  });
  ipcMain.handle('rss:listPipelineRuns', async (_event, params) => {
    return await runWithSqliteBusyRetry('listPipelineRuns', () => listPipelineRuns(params ?? {}));
  });
  ipcMain.handle('rss:listSourceEndpointHealth', async (_event, params) => {
    return await runWithSqliteBusyRetry('listSourceEndpointHealth', () => listSourceEndpointHealth(params ?? {}));
  });
  ipcMain.handle('rss:listFeedRunDiagnostics', async (_event, params) => {
    return await runWithSqliteBusyRetry('listFeedRunDiagnostics', () => listFeedRunDiagnostics(params ?? {}));
  });
  ipcMain.handle('rss:listFeedSyncStates', async (_event, params) => {
    return await runWithSqliteBusyRetry('listFeedSyncStates', () => listFeedSyncStates(params ?? {}));
  });
  ipcMain.handle('rss:resetSourceEndpointHealth', async (_event, endpointId: string) => {
    return await runWithStorageWriteRetry('resetSourceEndpointHealth', () => resetSourceEndpointHealth(endpointId));
  });
  ipcMain.handle('rss:getXApiFallbackStatus', async (_event, feedId: string) => {
    return await runWithSqliteBusyRetry('getXApiFallbackStatus', () => getXApiFallbackStatus(feedId));
  });
  ipcMain.handle('rss:setXApiFallbackEnabled', async (_event, input: { feedId: string; enabled: boolean }) => {
    return await runWithStorageWriteRetry('setXApiFallbackEnabled', () => {
      const status = getXApiFallbackStatus(input.feedId);
      if (!status.ok) return status;
      if (!input.enabled) {
        removeUserSourceEndpointsForFeed(input.feedId, X_API_PROVIDER_TYPE);
        return { ...getXApiFallbackStatus(input.feedId), enabled: false };
      }
      if (!status.eligible || !status.handle) return { ok: false, error: 'X_API_FEED_NOT_ELIGIBLE' as const };
      if (!status.configured) return { ok: false, error: 'X_API_NOT_CONFIGURED' as const, tokenFilePath: status.tokenFilePath };
      upsertSourceEndpointRecord({
        feedId: input.feedId,
        endpointRole: 'fallback',
        endpointUrl: buildXApiTwitterEndpointUrl(status.handle),
        providerType: X_API_PROVIDER_TYPE,
        managedBy: 'user',
        roleLocked: true,
      });
      return { ...getXApiFallbackStatus(input.feedId), enabled: true };
    });
  });
  ipcMain.handle('rss:listFeedEnrichmentStates', async (_event, params) => {
    return await runWithSqliteBusyRetry('listFeedEnrichmentStates', () => listFeedEnrichmentStates(params ?? {}));
  });
  ipcMain.handle('rss:getEnrichmentQueueStatus', () => readerJobManager.getStatus());
  ipcMain.handle('rss:fetchEntryContent', async (_event, id: string) => {
    try {
      const profileDir = getPlaywrightProfileDir();
      return await readerJobManager.enqueue({
        kind: 'fetch_entry_content',
        entryId: id,
        userDataDir: profileDir,
      });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('rss:resolveXiaoyuzhouAudio', async (_event, id: string) => {
    try {
      return await readerJobManager.enqueue({
        kind: 'resolve_xiaoyuzhou_audio',
        entryId: id,
      });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('rss:openWeChatLogin', async () => {
    try {
      const profileDir = getPlaywrightProfileDir();
      return await openWeChatLogin(profileDir);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('rss:getSocialThread', async (_event, id: string) => {
    try {
      return await readerJobManager.enqueue({
        kind: 'get_social_thread',
        entryId: id,
      });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('rss:createGroup', async (_event, name: string, parentId?: string | null) => {
    return await runWithStorageWriteRetry('createGroup', () => createGroup(name, parentId ?? null));
  });
  ipcMain.handle(
    'rss:updateGroup',
    async (_event, input: { id: string; name?: string; parentId?: string | null }) =>
      await runWithStorageWriteRetry('updateGroup', () => updateGroup(input.id, input)),
  );
  ipcMain.handle('rss:deleteGroup', async (_event, id: string) => {
    return await runWithStorageWriteRetry('deleteGroup', () => deleteGroup(id));
  });
  ipcMain.handle('rss:refreshAll', async (_event, options?: RssBatchJobOptions) => {
    try {
      const result = await enqueueRefreshAll({ options });
      return toRunOutcome(result);
    } catch (error) {
      return failedRun(error);
    }
  });
  ipcMain.handle('rss:refreshFeed', async (_event, id: string) => {
    try {
      const result = await enqueueRefreshFeed({ feedId: id });
      return toRunOutcome(result);
    } catch (error) {
      return failedRun(error);
    }
  });
  ipcMain.handle('rss:backfillFeed', async (_event, id: string, options?: { since?: number | null; maxPages?: number | null }) => {
    try {
      const result = await enqueueBackfillFeed({ feedId: id, options: withHistoryDepthDefaults(options) });
      return toRunOutcome(result);
    } catch (error) {
      return failedRun(error);
    }
  });
  ipcMain.handle('rss:backfillAll', async (_event, options?: RssBatchJobOptions) => {
    try {
      const result = await enqueueBackfillAll({ options: withHistoryDepthDefaults(options) });
      return toRunOutcome(result);
    } catch (error) {
      return failedRun(error);
    }
  });
  ipcMain.handle('rss:addFeed', (_event, input) => addSubscription(input));
  ipcMain.handle('rss:discoverFeeds', async (_event, input: string) => {
    try {
      return await discoverFeeds(input);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), candidates: [] };
    }
  });
  ipcMain.handle('rss:updateFeed', (_event, input) => updateSubscription(input, scheduleNextScheduledRefresh));
  ipcMain.handle('rss:deleteFeed', async (_event, id: string) => {
    const result = await runWithStorageWriteRetry('deleteFeed', () => deleteFeed(id));
    scheduleNextScheduledRefresh();
    return result;
  });
  ipcMain.handle('rss:previewOpml', async (event, options?: { groupId?: string | null; token?: string | null }) => {
    const now = Date.now();
    for (const [token, pending] of pendingOpmlPreviews) {
      if (now - pending.createdAt > OPML_PREVIEW_TTL_MS) pendingOpmlPreviews.delete(token);
    }

    let token = options?.token ?? null;
    let pending = token ? pendingOpmlPreviews.get(token) : undefined;
    if (!pending) {
      if (token) return { ok: false, error: 'OPML_PREVIEW_EXPIRED' as const };
      const parent = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? getMainWindow() ?? undefined;
      const dialogOptions: OpenDialogOptions = {
        properties: ['openFile'],
        filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }],
      };
      const result = parent ? await dialog.showOpenDialog(parent, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, error: 'CANCELLED' as const };
      }
      const filePath = result.filePaths[0];
      pending = { xml: await fs.promises.readFile(filePath, 'utf-8'), filePath, createdAt: now };
      token = randomUUID();
      pendingOpmlPreviews.set(token, pending);
    }

    const requestedGroupId = options?.groupId ?? null;
    const validRootGroupId = requestedGroupId && listGroups().some((group) => group.id === requestedGroupId) ? requestedGroupId : null;
    const summary = await runMaintenance('preview', { xml: pending.xml, rootGroupId: validRootGroupId });
    return { ok: true, token: token ?? undefined, filePath: pending.filePath, fileName: path.basename(pending.filePath), ...summary };
  });
  ipcMain.handle('rss:importOpml', async (_event, options?: { groupId?: string | null; token?: string | null }) => {
    const token = options?.token ?? null;
    if (!token) return { ok: false, error: 'OPML_PREVIEW_REQUIRED' as const };
    const pending = pendingOpmlPreviews.get(token);
    if (!pending || Date.now() - pending.createdAt > OPML_PREVIEW_TTL_MS) {
      pendingOpmlPreviews.delete(token);
      return { ok: false, error: 'OPML_PREVIEW_EXPIRED' as const };
    }
    const requestedGroupId = options?.groupId ?? null;
    const validRootGroupId = requestedGroupId && listGroups().some((group) => group.id === requestedGroupId) ? requestedGroupId : null;
    const summary = await runMaintenance('import', { xml: pending.xml, rootGroupId: validRootGroupId });
    pendingOpmlPreviews.delete(token);
    return { ok: true, filePath: pending.filePath, fileName: path.basename(pending.filePath), ...summary };
  });
  ipcMain.handle('rss:exportOpml', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? getMainWindow() ?? undefined;
    const dialogOptions: SaveDialogOptions = {
      defaultPath: 'catpaw.opml',
      filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }],
    };
    const result = parent ? await dialog.showSaveDialog(parent, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) {
      return { ok: false, error: 'CANCELLED' as const };
    }
    const xml = exportOpml();
    fs.writeFileSync(result.filePath, xml, 'utf-8');
    return { ok: true, filePath: result.filePath };
  });
}
