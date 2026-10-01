import { friendlyReaderError } from '../errors';
import { useEffect, useState } from 'react';
import type { RssBridge } from '../../../../../electron/contracts/rss';
import type { DialogProps } from './types';
import { useMaintenanceProgress } from '../useMaintenanceProgress';
import { AppUpdatePanel } from '../updates/AppUpdatePanel';
import { useAppUpdate } from '../updates/useAppUpdate';
export function MaintenanceDialog({ onClose, onChanged }: DialogProps['maintenance']) {
  const [status, setStatus] = useState<Awaited<ReturnType<RssBridge['getAppStatus']>> | null>(null);
  const [busy, setBusy] = useState(false);
  const update = useAppUpdate();
  const blocked = busy || update?.phase === 'installing';
  const progress = useMaintenanceProgress(busy);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!busy && (update?.phase === 'downloading' || update?.phase === 'installing')) onClose();
  }, [busy, onClose, update?.phase]);
  useEffect(() => { void window.catpaw!.rss.getAppStatus().then(setStatus).catch(() => setMessage('无法载入版本信息。')); }, []);
  const run = async (action: () => Promise<{ ok: boolean; error?: string; filePath?: string }>, success: string) => {
    setBusy(true); setMessage('');
    try {
      const result = await action();
      if (result.ok) { setMessage(`${success}${result.filePath ? `：${result.filePath}` : ''}`); await onChanged(); }
      else if (result.error !== 'CANCELLED') setMessage(friendlyReaderError(result.error));
    } catch (error) { setMessage(`操作未完成：${friendlyReaderError(error)}`); }
    finally { setBusy(false); }
  };
  const api = window.catpaw!.rss;
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="maintenance-title">
    <div className="modal-card maintenance-modal"><div className="modal-body">
      <h2 id="maintenance-title">应用与数据</h2><p>Catpaw {status?.version ?? '…'}</p>
      <AppUpdatePanel disabled={busy} />
      <p>阅读数据备份包含订阅与来源设置、文章、摘要和译文、已读、收藏及刷新设置。</p>
      <p>模型提供方配置、API 密钥和登录状态不在备份中。迁移到另一台电脑后，需要重新配置模型并登录相关来源。</p>
      <div className="modal-actions">
        <button className="modal-button" disabled={blocked} onClick={() => void run(api.backupDatabase, '备份已保存')}>备份阅读数据</button>
        <button className="modal-button" disabled={blocked} onClick={() => void run(api.restoreDatabase, '已准备恢复')}>从备份恢复</button>
      </div>
      <p>搜索结果不完整时，可以重新建立搜索索引。文章内容和收藏会保留。</p>
      <div className="modal-actions">
        <button className="modal-button" disabled={blocked} onClick={() => void run(api.rebuildSearchIndex, '搜索索引已重建')}>重建搜索索引</button>
        <button className="modal-button" disabled={blocked} onClick={() => void run(api.exportDiagnostics, '诊断信息已导出')}>导出诊断信息</button>
      </div>
      {message && <p role="status">{message}</p>}{busy && <p role="status">{progress}</p>}
    </div><div className="modal-actions maintenance-footer"><button className="modal-button ghost" disabled={blocked} onClick={onClose}>关闭</button></div></div>
  </div>;
}
