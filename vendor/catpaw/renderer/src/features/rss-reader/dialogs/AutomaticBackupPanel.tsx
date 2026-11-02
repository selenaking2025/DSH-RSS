import { useEffect, useRef, useState } from 'react';
import type { AutomaticBackupStatus } from '../../../../../electron/contracts/automatic-backup';
import { friendlyReaderError } from '../errors';
import './automatic-backup.css';

export function AutomaticBackupPanel({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<AutomaticBackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const request = revision.current;
      try {
        const result = await window.catpaw!.rss.getAutomaticBackupStatus();
        if (!stopped && request === revision.current) setStatus(result);
      } catch { if (!stopped && request === revision.current) setError('无法读取自动备份状态。'); }
      if (!stopped) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { stopped = true; mounted.current = false; revision.current++; clearTimeout(timer); };
  }, []);
  const run = async (action: () => Promise<AutomaticBackupStatus>) => {
    revision.current++;
    setBusy(true); setError('');
    try {
      const result = await action();
      if (mounted.current) setStatus(result);
    } catch (error) {
      if (mounted.current) setError(`操作未完成：${friendlyReaderError(error)}`);
    } finally {
      revision.current++;
      if (mounted.current) setBusy(false);
    }
  };
  const api = window.catpaw!.rss;
  const blocked = disabled || busy || status?.running || !status;
  return <section className="automatic-backup-panel" aria-labelledby="automatic-backup-title">
    <div className="automatic-backup-heading">
      <h3 id="automatic-backup-title">自动备份</h3>
      <label><input type="checkbox" checked={status?.enabled ?? true} disabled={blocked}
        onChange={(event) => void run(() => api.setAutomaticBackupEnabled(event.target.checked))} />每天备份</label>
    </div>
    <p>应用运行时每天保存一份，保留最近 7 份。错过的备份会在下次打开或唤醒时补做。</p>
    {status && <>
      <p className="automatic-backup-directory">备份目录：{status.directory}</p>
      <p role="status">{status.running ? '正在保存并检查备份…' : status.lastSuccessAt
        ? `最近成功：${new Date(status.lastSuccessAt).toLocaleString()}` : '尚未完成自动备份'}{!status.enabled && ' · 自动备份已关闭'}</p>
      {status.lastError && <p className="automatic-backup-error" role="alert">{status.lastError}
        {status.enabled ? '应用运行时一小时后自动重试，也可立即重试。' : '可点击立即备份重试。'}</p>}
    </>}
    <p>本机备份无法防止整盘故障。可选择外接盘或由你同步到其他设备的目录；目录不可用时会保留原有备份并重试。</p>
    <div className="modal-actions">
      <button className="modal-button" disabled={blocked} onClick={() => void run(api.chooseAutomaticBackupDirectory)}>选择备份目录</button>
      {status?.customDirectory && <button className="modal-button ghost" disabled={blocked} onClick={() => void run(api.resetAutomaticBackupDirectory)}>使用默认目录</button>}
      <button className="modal-button" disabled={blocked} onClick={() => void run(api.runAutomaticBackup)}>立即备份</button>
    </div>
    {error && <p className="automatic-backup-error" role="alert">{error}</p>}
  </section>;
}
