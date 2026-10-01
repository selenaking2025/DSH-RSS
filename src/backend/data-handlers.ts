import { nativeTheme } from 'electron';
import { readFile, writeFile, appendFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ipcMain, registerExtra, notifyReaderStateChanged } from './registry.ts';
import { getMaintenanceStatus, runMaintenance } from '../../.generated/catpaw/electron/services/maintenance';
import { CURRENT_SCHEMA_VERSION } from '../../.generated/catpaw/electron/data/db-schema';
import { ensureUserDataDir } from '../../.generated/catpaw/electron/runtime';
import { getThemePreference, saveThemePreference } from '../../.generated/catpaw/electron/data/appearance-repo';
import { exportOpml } from '../../.generated/catpaw/electron/services/opml';
import { getDb } from '../../.generated/catpaw/electron/data/db-core';
import { isRecord } from '../shared/protocol.ts';

export function registerDataHandlers() {
  const uploads = new Map<string, { owner: number; path: string; size: number; received: number; validated: boolean; expires: number; busy: boolean }>();
  const sweep = setInterval(() => {
    for (const [id, upload] of uploads) if (!upload.busy && upload.expires < Date.now()) {
      uploads.delete(id); void rm(upload.path, { force: true });
    }
  }, 60_000); sweep.unref();
  ipcMain.handle('rss:getMaintenanceStatus', () => getMaintenanceStatus());
  ipcMain.handle('rss:getThemePreference', () => getThemePreference());
  ipcMain.handle('rss:setThemePreference', (_event, preference) => {
    saveThemePreference(preference); nativeTheme.themeSource = preference; return preference;
  });
  ipcMain.handle('rss:getAppStatus', () => ({ version: '0.1.0', electron: process.versions.electron,
    schema: CURRENT_SCHEMA_VERSION, packaged: true }));
  ipcMain.handle('rss:rebuildSearchIndex', () => runMaintenance('rebuild', undefined));
  // File selection and download live in the browser; these explicit methods carry only file bytes.
  registerExtra('exportOpmlText', async () => ({ xml: exportOpml() }));
  registerExtra('stageOpml', async (_event, args) => {
    const input = args[0];
    if (!isRecord(input) || typeof input.xml !== 'string' || input.xml.length > 4 * 1024 * 1024
      || (input.groupId != null && typeof input.groupId !== 'string')) throw new Error('INVALID_OPML_FILE');
    return { ok: true, ...await runMaintenance('preview', { xml: input.xml, rootGroupId: input.groupId as string | null | undefined }) };
  });
  registerExtra('importOpmlText', async (_event, args) => {
    const input = args[0];
    if (!isRecord(input) || typeof input.xml !== 'string' || input.xml.length > 4 * 1024 * 1024
      || (input.groupId != null && typeof input.groupId !== 'string')) throw new Error('INVALID_OPML_FILE');
    const result = await runMaintenance('import', { xml: input.xml, rootGroupId: input.groupId as string | null | undefined });
    notifyReaderStateChanged(['subscriptions', 'entries', 'counts']);
    return { ok: true, ...result };
  });
  registerExtra('backupData', async () => {
    const directory = join(ensureUserDataDir(), 'transfers'); await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${randomUUID()}.sqlite3`);
    try {
      await runMaintenance('backup', { path });
      const bytes = await readFile(path);
      if (bytes.length > 32 * 1024 * 1024) throw new Error('当前浏览器导出上限为 32 MB，请从插件数据目录备份。');
      return { filename: 'catpaw-backup.sqlite3', base64: bytes.toString('base64') };
    } finally { await rm(path, { force: true }); }
  });
  registerExtra('diagnostics', async () => ({ schema: CURRENT_SCHEMA_VERSION, pluginVersion: '0.1.0',
    counts: getDb().prepare('SELECT (SELECT COUNT(*) FROM feeds) AS feeds, (SELECT COUNT(*) FROM entries) AS entries').get(),
    runtime: { platform: process.platform, arch: process.arch, electron: process.versions.electron } }));
  registerExtra('beginRestore', async (event, args) => {
    const size = args[0];
    if (!Number.isSafeInteger(size) || (size as number) < 100 || (size as number) > 32 * 1024 * 1024) throw new Error('备份文件须为有效数据库，且不超过 32 MB。');
    if ([...uploads.values()].some(upload => upload.owner === event.sender.id)) throw new Error('已有备份正在上传。');
    const id = randomUUID(), directory = join(ensureUserDataDir(), 'transfers');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${id}.sqlite3`);
    await writeFile(path, '', { mode: 0o600, flag: 'wx' });
    uploads.set(id, { owner: event.sender.id, path, size: size as number, received: 0, validated: false, expires: Date.now() + 900000, busy: false });
    event.sender.once('destroyed', () => {
      const upload = uploads.get(id);
      if (upload && !upload.busy) { uploads.delete(id); void rm(upload.path, { force: true }); }
    });
    return { id };
  });
  for (const method of ['appendRestore', 'validateRestore', 'commitRestore', 'discardRestore']) registerExtra(method, async (event, args) => {
    const [id, offset, base64] = args;
    const upload = typeof id === 'string' ? uploads.get(id) : undefined;
    if (!upload || upload.owner !== event.sender.id || upload.expires < Date.now()) throw new Error('RESTORE_UPLOAD_EXPIRED');
    if (upload.busy) throw new Error('RESTORE_UPLOAD_BUSY');
    upload.busy = true;
    try {
      if (method === 'appendRestore') {
        if (upload.validated || offset !== upload.received || typeof base64 !== 'string' || base64.length > 700000
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('INVALID_RESTORE_CHUNK');
        const chunk = Buffer.from(base64, 'base64');
        if (!chunk.length || upload.received + chunk.length > upload.size) throw new Error('INVALID_RESTORE_SIZE');
        await appendFile(upload.path, chunk); upload.received += chunk.length;
        return { received: upload.received };
      }
      if (method === 'discardRestore') {
        uploads.delete(id as string); await rm(upload.path, { force: true }); return { ok: true };
      }
      if (upload.received !== upload.size) throw new Error('RESTORE_UPLOAD_INCOMPLETE');
      if (method === 'validateRestore') {
        const summary = await runMaintenance('validate', { path: upload.path }); upload.validated = true;
        return summary;
      }
      if (!upload.validated) throw new Error('RESTORE_PREVIEW_REQUIRED');
      const result = await runMaintenance('restore', { path: upload.path }, true);
      uploads.delete(id as string); await rm(upload.path, { force: true });
      return { ...result, restartRequired: true };
    } finally { upload.busy = false; }
  });
}
