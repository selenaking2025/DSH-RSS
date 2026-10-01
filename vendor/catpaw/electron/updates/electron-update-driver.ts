import { CancellationToken, type AppUpdater, type ProgressInfo } from 'electron-updater';
import type { UpdateDriver } from '../services/app-updates';

export class ElectronUpdateDriver implements UpdateDriver {
  private cancellation?: CancellationToken;
  private nativeReady = false;
  private cancelPreparation?: () => void;

  constructor(private readonly updater: AppUpdater, private readonly native: Electron.AutoUpdater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    // Read the product-specific channel from the signed app-update.yml. The
    // shared download server also hosts other apps' latest-mac.yml files.
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableDifferentialDownload = true;
    updater.logger = console;
    updater.on('error', (error) => console.warn('[app-update]', error));
  }

  async check() {
    const result = await this.updater.checkForUpdates();
    if (!result) throw new Error('UPDATER_UNAVAILABLE');
    return result.isUpdateAvailable && !result.updateInfo.version.split('+')[0].includes('-') ? { version: result.updateInfo.version } : null;
  }

  async download(onProgress: (progress: ProgressInfo) => void) {
    this.nativeReady = false;
    const token = new CancellationToken();
    this.cancellation = token;
    const deadline = setTimeout(() => token.cancel(), 30 * 60_000);
    this.updater.on('download-progress', onProgress);
    try { await this.updater.downloadUpdate(token); }
    finally {
      clearTimeout(deadline);
      this.updater.removeListener('download-progress', onProgress);
      this.cancellation = undefined;
    }
  }

  prepareInstall(): Promise<void> {
    if (this.nativeReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(deadline);
        this.native.removeListener('update-downloaded', ready);
        this.native.removeListener('error', failed);
        this.cancelPreparation = undefined;
        if (error) reject(error);
        else { this.nativeReady = true; resolve(); }
      };
      const ready = () => finish();
      const failed = (error: Error) => finish(error);
      const deadline = setTimeout(() => finish(new Error('UPDATE_INSTALL_TIMEOUT')), 2 * 60_000);
      this.cancelPreparation = () => finish(new Error('UPDATE_INSTALL_CANCELLED'));
      this.native.once('update-downloaded', ready);
      this.native.once('error', failed);
      // electron-updater has already configured a private loopback feed for the
      // downloaded ZIP. This verifies its macOS signature without quitting.
      try { this.native.checkForUpdates(); } catch (error) { finish(error as Error); }
    });
  }

  install() {
    if (!this.nativeReady) throw new Error('UPDATE_NOT_READY');
    this.updater.quitAndInstall();
  }

  cancel() { this.cancellation?.cancel(); this.cancelPreparation?.(); }
}
