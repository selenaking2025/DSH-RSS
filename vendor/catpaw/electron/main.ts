import { startPerformanceMetrics } from './diagnostics/performance';
import { initializeReaderData } from './services/initialize-reader-data';
import { installDiagnostics } from './services/diagnostics';
import { runMaintenance } from './services/maintenance';
import { maintenanceJobManager } from './maintenance-job-manager';
import { registerMaintenanceHandlers } from './ipc/maintenance-handlers';
import { registerModelProviderHandlers } from './ipc/model-provider-handlers';
import { registerSummaryHandlers, stopArticleSummaries } from './ipc/summary-handlers';
import { registerTranslationHandlers, stopArticleTranslations } from './ipc/translation-handlers';
import { app, session } from 'electron';
import { recoverStartup } from './services/startup-recovery';
import { configureElectronAppIdentity } from './app-identity';
import { closeBrowserHost } from './browser/host';
import { closeDb } from './data/db-core';
import { createWindow, getMainWindow } from './desktop-window';
import { registerReaderNotifications } from './ipc/reader-notifications';
import { registerRssHandlers } from './ipc/rss-handlers';
import { readerJobManager } from './reader-job-manager';
import { rssJobManager } from './rss-job-manager';
import { secureReaderSession } from './security/renderer-policy';
import { registerSchedulers, stopSchedulers } from './services/scheduler';
import { installYoutubeEmbedSessionIdentity } from './youtube-embed-session';
import { createAppUpdates } from './updates/create-app-updates';
import { registerUpdateHandlers } from './ipc/update-handlers';
import { beginShutdown } from './services/shutdown-state';
import { smartReading } from './services/smart-reading';
import { registerReadingHandlers } from './ipc/reading-handlers';

configureElectronAppIdentity(app);
let updates: ReturnType<typeof createAppUpdates> | undefined;
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else {
  app.on('second-instance', () => createWindow());
  app.whenReady().then(async () => {
    installDiagnostics();
    startPerformanceMetrics();
    await runMaintenance('applyRestore', undefined);
    const userAgent = app.userAgentFallback.replace(/\sElectron\/[\d.]+/, '')
      .replace(new RegExp(`\\s${app.getName()}\\/[\\d.]+`, 'i'), '');
    app.userAgentFallback = userAgent;
    session.defaultSession.setUserAgent(userAgent);
    secureReaderSession(session.defaultSession);
    installYoutubeEmbedSessionIdentity(session.defaultSession.webRequest, {
      getAllowedWebContentsId: () => getMainWindow()?.webContents.id ?? null,
    });
    const db = await initializeReaderData();
    db.transaction(() => {
      db.prepare("UPDATE pipeline_runs SET status = 'failed', finished_at = ?, error = 'APP_INTERRUPTED' WHERE status = 'running'").run(Date.now());
      db.exec("UPDATE entries SET content_fetch_status = 'failed', content_fetch_error = 'APP_INTERRUPTED' WHERE content_fetch_status = 'fetching'");
    }).immediate();
    registerRssHandlers();
    registerMaintenanceHandlers();
    updates = createAppUpdates(prepareToQuit);
    registerUpdateHandlers(updates);
    registerModelProviderHandlers();
    registerTranslationHandlers();
    registerSummaryHandlers();
    registerReadingHandlers();
    registerReaderNotifications();
    createWindow();
    registerSchedulers();
    updates.start();
    smartReading.begin();
    app.on('activate', () => createWindow());
  }).catch(recoverStartup);
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let quitting: Promise<void> | null = null;
let quitReady = false;
function prepareToQuit() {
  if (quitting) return quitting;
  beginShutdown();
  updates?.stop();
  stopArticleTranslations();
  stopArticleSummaries();
  stopSchedulers();
  rssJobManager.pause(); readerJobManager.pause();
  quitting = Promise.all([smartReading.stop(), maintenanceJobManager.shutdown()]).then(() => Promise.all([rssJobManager.shutdown(), readerJobManager.shutdown()])).then(() => {
    closeBrowserHost();
    closeDb();
    quitReady = true;
  });
  return quitting;
}
app.on('before-quit', (event) => {
  if (quitReady) return;
  event.preventDefault();
  void prepareToQuit().then(() => app.quit()).catch((error) => console.error('退出前清理失败', error));
});
