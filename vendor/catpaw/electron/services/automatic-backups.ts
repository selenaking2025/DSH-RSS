import { powerMonitor } from 'electron';
import { AutomaticBackupService } from './automatic-backup-service';
import { runMaintenance } from './maintenance';
import { readAutomaticBackupSettings, saveAutomaticBackupSettings, defaultBackupDirectory } from '../data/automatic-backup-settings';

export const automaticBackups = new AutomaticBackupService({
  read: readAutomaticBackupSettings, save: saveAutomaticBackupSettings, defaultDirectory: defaultBackupDirectory,
  backup: (input) => runMaintenance('automaticBackup', input),
});
export function startAutomaticBackups() {
  automaticBackups.start();
  powerMonitor.on('resume', automaticBackups.wake);
}
export function stopAutomaticBackups() {
  powerMonitor.removeListener('resume', automaticBackups.wake);
  return automaticBackups.stop();
}
