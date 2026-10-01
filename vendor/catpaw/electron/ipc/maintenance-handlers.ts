import { getAppMetadata } from '../app-metadata';
import { app, dialog, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain } from './register';
import { getMainWindow } from '../desktop-window';
import { getMaintenanceStatus, runMaintenance } from '../services/maintenance';
import { getDb } from '../data/db-core';
import { CURRENT_SCHEMA_VERSION } from '../data/db-schema';
import { ensureUserDataDir } from '../runtime';
import { redactDiagnostic } from '../services/diagnostics';
import { saveThemePreference } from '../data/appearance-repo';

export function registerMaintenanceHandlers() {
  ipcMain.handle('rss:getMaintenanceStatus', () => getMaintenanceStatus());
  ipcMain.handle('rss:getThemePreference', () => nativeTheme.themeSource);
  ipcMain.handle('rss:setThemePreference', (_event, preference) => {
    saveThemePreference(preference);
    nativeTheme.themeSource = preference;
    return preference;
  });
  ipcMain.handle('rss:getAppStatus', () => ({
    version: getAppMetadata().version, electron: process.versions.electron, schema: CURRENT_SCHEMA_VERSION,
    packaged: app.isPackaged,
  }));
  ipcMain.handle('rss:backupDatabase', async () => {
    const selected = await dialog.showSaveDialog(getMainWindow()!, { defaultPath: `Catpaw-backup-${new Date().toISOString().slice(0, 10)}.sqlite3`, filters: [{ name: 'Catpaw 数据备份', extensions: ['sqlite3'] }] });
    if (selected.canceled || !selected.filePath) return { ok: false, error: 'CANCELLED' };
    return runMaintenance('backup', { path: selected.filePath });
  });
  ipcMain.handle('rss:restoreDatabase', async () => {
    const selected = await dialog.showOpenDialog(getMainWindow()!, { properties: ['openFile'], filters: [{ name: 'Catpaw 数据备份', extensions: ['sqlite3'] }] });
    if (selected.canceled || !selected.filePaths[0]) return { ok: false, error: 'CANCELLED' };
    const source = selected.filePaths[0];
    const summary = await runMaintenance('validate', { path: source });
    const confirmation = await dialog.showMessageBox(getMainWindow()!, {
      type: 'question', buttons: ['取消', '恢复并重启'], defaultId: 0, cancelId: 0,
      message: '恢复这份 Catpaw 备份？',
      detail: `备份中有 ${summary.feeds} 个订阅源和 ${summary.entries} 篇文章。当前数据会先保存为另一份备份，然后重启应用完成恢复。`,
    });
    if (confirmation.response !== 1) return { ok: false, error: 'CANCELLED' };
    const result = await runMaintenance('restore', { path: source }, true);
    app.relaunch(); app.quit();
    return result;
  });
  ipcMain.handle('rss:rebuildSearchIndex', () => runMaintenance('rebuild', undefined));
  ipcMain.handle('rss:exportDiagnostics', async () => {
    const selected = await dialog.showSaveDialog(getMainWindow()!, { defaultPath: 'Catpaw-diagnostics.json', filters: [{ name: '诊断信息', extensions: ['json'] }] });
    if (selected.canceled || !selected.filePath) return { ok: false, error: 'CANCELLED' };
    const log = path.join(ensureUserDataDir(), 'logs', 'app.log');
    const payload = {
      version: getAppMetadata().version, electron: process.versions.electron, platform: process.platform, arch: process.arch,
      schema: CURRENT_SCHEMA_VERSION,
      counts: getDb().prepare('SELECT (SELECT COUNT(*) FROM feeds) AS feeds, (SELECT COUNT(*) FROM entries) AS entries').get(),
      recentLog: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(-64 * 1024) : '',
    };
    fs.writeFileSync(selected.filePath, redactDiagnostic(JSON.stringify(payload, null, 2)), { mode: 0o600 });
    return { ok: true, filePath: selected.filePath };
  });
}
