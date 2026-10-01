import type { RssBridge } from '../../.generated/catpaw/electron/contracts/rss';
import type { createBridge } from './bridge.ts';
import { isRecord } from '../shared/protocol.ts';

async function chooseFile(accept: string): Promise<File | undefined> {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
    input.style.display = 'none'; document.body.append(input);
    const finish = (file?: File) => { input.remove(); resolve(file); };
    input.onchange = () => finish(input.files?.[0]); input.oncancel = () => finish(); input.click();
  });
}
function download(name: string, value: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function installFileActions(bridge: ReturnType<typeof createBridge>, confirm: (question: { title: string; detail: string; confirmLabel?: string }) => Promise<boolean>) {
  const previews = new Map<string, { xml: string; name: string; expires: number }>();
  bridge.rss.previewOpml = async options => {
    let token = options?.token;
    let preview = token ? previews.get(token) : undefined;
    if (token && (!preview || preview.expires < Date.now())) return { ok: false, error: 'OPML_PREVIEW_EXPIRED' };
    if (!preview) {
      const file = await chooseFile('.opml,.xml'); if (!file) return { ok: false, error: 'CANCELLED' };
      if (file.size > 4 * 1024 * 1024) return { ok: false, error: 'OPML 文件不能超过 4 MB。' };
      token = crypto.randomUUID(); preview = { xml: await file.text(), name: file.name, expires: Date.now() + 900000 };
      previews.set(token, preview);
    }
    const summary = await bridge.request('stageOpml', [{ xml: preview.xml, groupId: options?.groupId }]);
    if (!isRecord(summary)) throw new Error('OPML 预览格式无效。');
    return { ...summary, ok: true, token, filePath: preview.name, fileName: preview.name } as Awaited<ReturnType<RssBridge['previewOpml']>>;
  };
  bridge.rss.importOpml = async options => {
    const pending = options?.token ? previews.get(options.token) : undefined;
    if (!pending || pending.expires < Date.now()) return { ok: false, error: 'OPML_PREVIEW_EXPIRED' };
    const summary = await bridge.request('importOpmlText', [{ xml: pending.xml, groupId: options?.groupId }]);
    if (!isRecord(summary)) throw new Error('OPML 导入结果无效。');
    previews.delete(options!.token!);
    return { ...summary, ok: true, filePath: pending.name, fileName: pending.name } as Awaited<ReturnType<RssBridge['importOpml']>>;
  };
  bridge.rss.exportOpml = async () => {
    const result = await bridge.request('exportOpmlText');
    if (!isRecord(result) || typeof result.xml !== 'string') throw new Error('OPML 导出结果无效。');
    download('catpaw.opml', result.xml, 'text/xml'); return { ok: true, filePath: 'catpaw.opml' };
  };
  bridge.rss.backupDatabase = async () => {
    const result = await bridge.request('backupData');
    if (!isRecord(result) || typeof result.base64 !== 'string') throw new Error('备份格式无效。');
    const bytes = Uint8Array.from(atob(result.base64), value => value.charCodeAt(0));
    download('catpaw-backup.sqlite3', bytes, 'application/vnd.sqlite3'); return { ok: true, filePath: 'catpaw-backup.sqlite3' };
  };
  bridge.rss.restoreDatabase = async () => {
    const file = await chooseFile('.sqlite3,.db');
    if (!file) return { ok: false, error: 'CANCELLED' };
    if (file.size > 32 * 1024 * 1024) return { ok: false, error: '浏览器恢复上限为 32 MB。' };
    const result = await bridge.request('beginRestore', [file.size]);
    if (!isRecord(result) || typeof result.id !== 'string') throw new Error('创建恢复任务失败。');
    const id = result.id;
    let committed = false;
    try {
      for (let offset = 0; offset < file.size; offset += 512 * 1024) {
        const bytes = new Uint8Array(await file.slice(offset, offset + 512 * 1024).arrayBuffer());
        let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        await bridge.request('appendRestore', [id, offset, btoa(binary)]);
      }
      const preview = await bridge.request('validateRestore', [id]);
      if (!isRecord(preview) || !Number.isSafeInteger(preview.feeds) || !Number.isSafeInteger(preview.entries)) throw new Error('备份校验失败。');
      if (!await confirm({ title: '恢复备份', confirmLabel: '恢复并重新载入', detail: `恢复「${file.name}」？\n包含 ${preview.feeds} 个订阅源、${preview.entries} 篇文章。\n当前数据会先保存为回滚备份，随后重新启动 Catpaw 后台。` })) return { ok: false, error: 'CANCELLED' };
      await bridge.request('commitRestore', [id]); committed = true;
      return { ok: true };
    } finally {
      if (!committed) await bridge.request('discardRestore', [id]).catch(() => {});
    }
  };
  bridge.rss.exportDiagnostics = async () => {
    download('catpaw-diagnostics.json', JSON.stringify(await bridge.request('diagnostics'), null, 2), 'application/json');
    return { ok: true, filePath: 'catpaw-diagnostics.json' };
  };
}
