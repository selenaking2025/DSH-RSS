import { app, autoUpdater as nativeUpdater } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import { getAppMetadata } from '../app-metadata';
import { AppUpdates } from '../services/app-updates';
import { ElectronUpdateDriver } from './electron-update-driver';

export function createAppUpdates(prepareToQuit: () => Promise<void>) {
  const unavailable = !app.isPackaged ? '开发版本不检查更新，请使用已安装的正式应用。'
    : process.platform !== 'darwin' ? '此平台暂不支持应用内更新。'
      : !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml')) ? '此安装包尚未配置更新服务。' : undefined;
  return new AppUpdates({ version: getAppMetadata().version, prepareToQuit, unavailable,
    driver: unavailable ? undefined : new ElectronUpdateDriver(autoUpdater, nativeUpdater),
    logError: (error) => console.warn('[app-update]', error),
  });
}
