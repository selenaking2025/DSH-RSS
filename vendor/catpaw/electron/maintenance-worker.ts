import { closeDb } from './data/db-core';
import { rebuildSearchIndex } from './data/entry-repo';
import { importOpmlFromStringWithOptions, previewOpmlFromStringWithOptions } from './services/opml';
import { backupDatabase, validateDatabaseBackup, prepareDatabaseRestore, applyPendingDatabaseRestore } from './data/database-backup';
import type { MaintenanceMessage, MaintenanceRequest, MaintenanceOutputs } from './contracts/maintenance';

const send = (message: MaintenanceMessage) => process.send?.(message);
let active = false;
process.on('message', async (request: MaintenanceRequest) => {
  if (active || !request?.requestId) return;
  active = true;
  const progress = (completed: number, total: number) => send({ type: 'progress', requestId: request.requestId, completed, total });
  try {
    let value: MaintenanceOutputs[keyof MaintenanceOutputs];
    switch (request.kind) {
      case 'rebuild': value = rebuildSearchIndex(progress); break;
      case 'preview': value = previewOpmlFromStringWithOptions(request.input.xml, request.input); break;
      case 'import': value = importOpmlFromStringWithOptions(request.input.xml, request.input, progress); break;
      case 'backup': value = await backupDatabase(request.input.path); break;
      case 'validate': value = validateDatabaseBackup(request.input.path); break;
      case 'restore': value = await prepareDatabaseRestore(request.input.path, request.input.mode); break;
      case 'applyRestore': value = await applyPendingDatabaseRestore(); break;
      default: throw new Error('UNKNOWN_MAINTENANCE_OPERATION');
    }
    closeDb();
    send({ type: 'result', payload: { requestId: request.requestId, kind: request.kind, ok: true, value } });
  } catch (error) {
    closeDb();
    send({ type: 'result', payload: { requestId: request.requestId, kind: request.kind, ok: false, error: error instanceof Error ? error.message : String(error) } });
  } finally { active = false; }
});
process.once('disconnect', () => { closeDb(); process.exit(0); });
send({ type: 'ready' });
