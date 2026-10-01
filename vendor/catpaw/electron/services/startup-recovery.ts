import { app, dialog, shell } from 'electron';
import path from 'node:path';
import { runMaintenance } from './maintenance';

export async function recoverStartup(error: unknown) {
  console.error('[startup] database could not be opened', error);
  const result = await dialog.showMessageBox({ type: 'error', message: 'Catpaw 无法打开本地数据',
    detail: `原数据已保留。可以选择一份 Catpaw 备份恢复；恢复前会完整保存当前数据文件。\n${error instanceof Error ? error.message : String(error)}`,
    buttons: ['退出', '从备份恢复', '打开备份目录'], defaultId: 0, cancelId: 0 });
  if (result.response === 2) await shell.openPath(path.join(app.getPath('userData'), 'backups'));
  if (result.response === 1) {
    try {
      const selected = await dialog.showOpenDialog({ properties: ['openFile'],
        defaultPath: path.join(app.getPath('userData'), 'backups'),
        filters: [{ name: 'Catpaw 数据备份', extensions: ['sqlite3'] }] });
      if (!selected.canceled && selected.filePaths[0]) {
        const source = selected.filePaths[0];
        const summary = await runMaintenance('validate', { path: source });
        const confirmation = await dialog.showMessageBox({ type: 'question', message: '从这份备份恢复？',
          detail: `包含 ${summary.feeds} 个订阅源、${summary.entries} 篇文章。当前文件会保存在备份目录中。`,
          buttons: ['取消', '恢复并重启'], defaultId: 0, cancelId: 0 });
        if (confirmation.response === 1) {
          await runMaintenance('restore', { path: source, mode: 'unreadable' }, true);
          app.relaunch();
        }
      }
    } catch (restoreError) {
      dialog.showErrorBox('无法恢复这份备份', `当前数据保持原样。${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
  }
  app.quit();
}
