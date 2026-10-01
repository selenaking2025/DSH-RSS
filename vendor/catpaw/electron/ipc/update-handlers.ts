import { ipcMain } from './register';
import { getMainWindow } from '../desktop-window';
import type { AppUpdates } from '../services/app-updates';

export function registerUpdateHandlers(updates: AppUpdates) {
  ipcMain.handle('rss:getUpdateStatus', () => updates.getStatus());
  ipcMain.handle('rss:checkForUpdates', () => updates.check());
  ipcMain.handle('rss:downloadUpdate', () => updates.download());
  ipcMain.handle('rss:installUpdate', () => updates.install());
  return updates.subscribe((status) => {
    const window = getMainWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('rss:updateStatusChanged', status);
  });
}
