import { BrowserWindow, dialog } from 'electron';
import { realpath } from 'node:fs/promises';
import { ipcMain } from './registry.ts';
import { automaticBackups } from '../../.generated/catpaw/electron/services/automatic-backups';
import { isShuttingDown } from '../../.generated/catpaw/electron/services/shutdown-state';

export function registerAutomaticBackupHandlers() {
  ipcMain.handle('rss:getAutomaticBackupStatus', () => automaticBackups.getStatus());
  ipcMain.handle('rss:setAutomaticBackupEnabled', (_event, enabled) => automaticBackups.configure({ enabled }));
  ipcMain.handle('rss:resetAutomaticBackupDirectory', () => automaticBackups.configure({ directory: null }));
  ipcMain.handle('rss:runAutomaticBackup', async () => {
    await automaticBackups.runDue(true);
    return automaticBackups.getStatus();
  });
  ipcMain.handle('rss:chooseAutomaticBackupDirectory', async ({ sender }) => {
    const owner = BrowserWindow.fromWebContents(sender);
    if (!owner || owner.isDestroyed()) throw new Error('CATPAW_CLIENT_CLOSED');
    const selected = await dialog.showOpenDialog(owner, {
      title: '选择运行 Harness 的电脑上的备份目录', properties: ['openDirectory', 'createDirectory'],
    });
    if (isShuttingDown() || sender.isDestroyed()) throw new Error('CATPAW_STOPPING');
    if (selected.canceled || !selected.filePaths[0]) return automaticBackups.getStatus();
    const directory = await realpath(selected.filePaths[0]);
    if (isShuttingDown() || sender.isDestroyed()) throw new Error('CATPAW_STOPPING');
    return automaticBackups.configure({ directory });
  });
}
