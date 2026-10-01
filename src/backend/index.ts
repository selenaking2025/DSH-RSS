import { app } from 'electron';
import path from 'node:path';
import { configureElectronAppIdentity } from '../../.generated/catpaw/electron/app-identity';
import { initializeReaderData } from '../../.generated/catpaw/electron/services/initialize-reader-data';
import { registerRssHandlers } from '../../.generated/catpaw/electron/ipc/rss-handlers';
import { registerModelProviderHandlers } from '../../.generated/catpaw/electron/ipc/model-provider-handlers';
import { registerSummaryHandlers, stopArticleSummaries } from '../../.generated/catpaw/electron/ipc/summary-handlers';
import { registerTranslationHandlers, stopArticleTranslations } from '../../.generated/catpaw/electron/ipc/translation-handlers';
import { registerReadingHandlers } from '../../.generated/catpaw/electron/ipc/reading-handlers';
import { registerReaderNotifications } from '../../.generated/catpaw/electron/ipc/reader-notifications';
import { registerSchedulers, stopSchedulers } from '../../.generated/catpaw/electron/services/scheduler';
import { beginShutdown } from '../../.generated/catpaw/electron/services/shutdown-state';
import { rssJobManager } from '../../.generated/catpaw/electron/rss-job-manager';
import { readerJobManager } from '../../.generated/catpaw/electron/reader-job-manager';
import { maintenanceJobManager } from '../../.generated/catpaw/electron/maintenance-job-manager';
import { smartReading } from '../../.generated/catpaw/electron/services/smart-reading';
import { runMaintenance } from '../../.generated/catpaw/electron/services/maintenance';
import { closeDb } from '../../.generated/catpaw/electron/data/db-core';
import { closeBrowserHost } from '../../.generated/catpaw/electron/browser/host';
import { ipcMain, invoke, methods } from './registry.ts';
import { ownerWindow, closeOwner, closeWindows, send, touchOwner, reapOwners } from './windows.ts';
import { isRecord, parseCall, errorMessage } from '../shared/protocol.ts';
import { registerDataHandlers } from './data-handlers.ts';
import { withRequestSignal } from './request-scope.ts';

if (!process.send || !process.env.CATPAW_USER_DATA_DIR || !path.isAbsolute(process.env.CATPAW_USER_DATA_DIR)) {
  throw new Error('Start the Catpaw backend through its Harness plugin with an explicit data directory.');
}
configureElectronAppIdentity(app);
app.setName('Catpaw for Harness');
if (!app.requestSingleInstanceLock()) {
  send({ kind: 'fatal', error: 'CATPAW_DATA_DIRECTORY_IN_USE' }); app.exit(1);
}
app.on('window-all-closed', () => {});
let stopping: Promise<void> | undefined;
const active = new Map<string, { owner: string; method: string; args: unknown[]; controller: AbortController }>();
async function stop() {
  if (stopping) return stopping;
  beginShutdown(); stopSchedulers(); stopArticleSummaries(); stopArticleTranslations();
  for (const request of active.values()) request.controller.abort();
  rssJobManager.pause(); readerJobManager.pause();
  stopping = (async () => {
    await smartReading.stop();
    await maintenanceJobManager.shutdown();
    await Promise.all([rssJobManager.shutdown(), readerJobManager.shutdown()]);
    closeBrowserHost(); closeDb(); closeWindows(); app.exit(0);
  })();
  return stopping;
}
app.on('before-quit', event => { event.preventDefault(); void stop(); });
process.on('disconnect', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });

async function main() {
await app.whenReady();
app.dock?.hide();
try {
  await runMaintenance('applyRestore', undefined);
  const db = await initializeReaderData();
  db.prepare("UPDATE pipeline_runs SET status = 'failed', finished_at = ?, error = 'APP_INTERRUPTED' WHERE status IN ('running', 'queued')").run(Date.now());
  registerRssHandlers(); registerModelProviderHandlers(); registerSummaryHandlers(); registerTranslationHandlers();
  registerReadingHandlers(); registerDataHandlers(); registerReaderNotifications();
  const reaper = setInterval(() => reapOwners(new Set([...active.values()].map(request => request.owner))), 60_000); reaper.unref();
  ipcMain.handle('rss:getUpdateStatus', () => ({ revision: 0, phase: 'unavailable', currentVersion: '0.1.0', message: '此版本由 Harness 插件管理器更新。' }));
  for (const channel of ['checkForUpdates', 'downloadUpdate', 'installUpdate'] as const) {
    ipcMain.handle(`rss:${channel}`, () => ({ ok: false, error: '请通过 Harness 插件管理器更新 Catpaw。' }));
  }
  process.on('message', message => {
    if (!isRecord(message)) return;
    if (message.kind === 'shutdown') { void stop(); return; }
    if (message.kind === 'touch' && typeof message.owner === 'string') { touchOwner(message.owner); return; }
    if (message.kind === 'release' && typeof message.owner === 'string') {
      for (const request of active.values()) if (request.owner === message.owner) request.controller.abort();
      closeOwner(message.owner); return;
    }
    if (message.kind === 'cancel' && typeof message.id === 'string') {
      const request = active.get(message.id);
      request?.controller.abort();
      if (request?.method === 'analyzeEntry' || request?.method === 'translateArticle') {
        const input = request.args[0];
        if (isRecord(input)) void invoke(request.method === 'analyzeEntry' ? 'cancelArticleSummary' : 'cancelArticleTranslation', [input.requestId], ownerWindow(request.owner).webContents);
      }
      return;
    }
    if (message.kind !== 'call') return;
    void (async () => {
      let id = typeof message.id === 'string' ? message.id : '';
      try {
        const request = parseCall(message); id = request.id;
        if (stopping) throw new Error('CATPAW_STOPPING');
        if (active.has(id)) throw new Error('DUPLICATE_CATPAW_REQUEST');
        const controller = new AbortController(); active.set(id, { ...request, controller });
        const value = await withRequestSignal(controller.signal, () => invoke(request.method, request.args, ownerWindow(request.owner).webContents));
        send({ kind: 'result', id, ok: true, value: value ?? null });
      } catch (error) { send({ kind: 'result', id, ok: false, error: errorMessage(error) }); }
      finally { active.delete(id); }
    })();
  });
  if (process.env.CATPAW_DISABLE_SCHEDULER !== '1') { registerSchedulers(); smartReading.begin(); }
  send({ kind: 'ready', methods: methods() });
} catch (error) { send({ kind: 'fatal', error: errorMessage(error) }); await stop(); }
}
void main();
