import { app } from 'electron';
import path from 'node:path';
import { configureElectronAppIdentity } from './app-identity';
import { runCli } from './cli';
import { closeBrowserHost } from './browser/host';
import { closeDb } from './data/db-core';
import { rssJobManager } from './rss-job-manager';

const argv = process.argv.slice(2);
const overrideIndex = argv.indexOf('--user-data-dir');
if (overrideIndex >= 0 && argv[overrideIndex + 1] && !argv[overrideIndex + 1].startsWith('--')) {
  process.env.CATPAW_USER_DATA_DIR = path.resolve(argv[overrideIndex + 1]);
}
configureElectronAppIdentity(app);
if (!app.requestSingleInstanceLock()) {
  console.error('Catpaw 正在使用这份数据。请先退出阅读器，或通过 --user-data-dir 指定独立目录。');
  app.exit(1);
} else {
  app.on('window-all-closed', () => {});
  void app.whenReady().then(async () => {
    app.dock?.hide();
    let code = 1;
    try { code = await runCli(argv); }
    finally {
      await rssJobManager.shutdown();
      closeBrowserHost();
      closeDb();
    }
    app.exit(code);
  }).catch((error) => { console.error(error); app.exit(1); });
}
