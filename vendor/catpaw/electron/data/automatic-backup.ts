import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { backupDatabase, validateDatabaseBackup } from './database-backup';
import { BACKUP_ID_PATTERN, defaultBackupDirectory } from './automatic-backup-settings';
import { RETAINED_AUTOMATIC_BACKUPS } from '../contracts/automatic-backup';

export type AutomaticBackupInput = { id: string; directory: string | null };
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

function pruneBackups(directory: string, id: string, newest: string) {
  const pattern = new RegExp(`^catpaw-daily-${id}-(\\d+)-${UUID}\\.sqlite3$`);
  const candidates = fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const match = entry.isFile() ? pattern.exec(entry.name) : null;
    return match ? [{ filePath: path.join(directory, entry.name), createdAt: Number(match[1]) }] : [];
  }).filter((entry) => entry.filePath !== newest)
    .sort((a, b) => b.createdAt - a.createdAt || b.filePath.localeCompare(a.filePath));
  let retained = 1;
  for (const candidate of candidates) {
    try {
      // Only verified snapshots from this installation participate in retention.
      if (['-journal', '-wal', '-shm'].some((suffix) => fs.existsSync(candidate.filePath + suffix))) continue;
      validateDatabaseBackup(candidate.filePath);
      if (retained < RETAINED_AUTOMATIC_BACKUPS) { retained++; continue; }
      fs.unlinkSync(candidate.filePath);
    } catch (error) { console.warn('[backup] Preserving snapshot that could not be validated or removed', candidate.filePath, error); }
  }
}

function removeInterruptedBackups(directory: string, id: string) {
  const pattern = new RegExp(`^catpaw-daily-${id}-\\d+-${UUID}\\.sqlite3\\.${UUID}\\.tmp(?:-journal|-wal|-shm)?$`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue;
    try { fs.unlinkSync(path.join(directory, entry.name)); }
    catch (error) { console.warn('[backup] Could not remove interrupted automatic backup', entry.name, error); }
  }
}

export async function createAutomaticBackup(input: AutomaticBackupInput) {
  if (!BACKUP_ID_PATTERN.test(input.id)) throw new Error('INVALID_AUTOMATIC_BACKUP_ID');
  const directory = input.directory ?? defaultBackupDirectory();
  if (input.directory === null) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Never recreate a missing external mount or silently fall back to the local disk.
  if (!path.isAbsolute(directory) || !fs.statSync(directory).isDirectory()) throw new Error('BACKUP_DIRECTORY_UNAVAILABLE');
  const destination = path.join(directory, `catpaw-daily-${input.id}-${Date.now()}-${randomUUID()}.sqlite3`);
  const result = await backupDatabase(destination);
  // Publication/validation must succeed before any previous recovery point is removed.
  try { pruneBackups(directory, input.id, destination); }
  catch (error) { console.warn('[backup] Could not prune automatic backups', error); }
  // A terminated worker cannot run its finally block. Clean up its own staging
  // files only after a new usable recovery point has been published.
  try { removeInterruptedBackups(directory, input.id); }
  catch (error) { console.warn('[backup] Could not clean up interrupted backups', error); }
  return result;
}
