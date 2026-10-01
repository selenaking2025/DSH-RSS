import type { AppUpdateAction, AppUpdateStatus } from '../../../../../electron/contracts/app-update';
import { useAppUpdate, useAppUpdateAction } from './useAppUpdate';

const labels: Record<AppUpdateAction, string> = { check: '检查更新', download: '下载并重启', install: '重试安装并重启' };
function describe(status: AppUpdateStatus) {
  switch (status.phase) {
    case 'idle': return '应用会自动检查新版本，也可以随时手动检查。';
    case 'checking': return '正在检查更新…';
    case 'current': return '当前已是最新版本。';
    case 'available': return `发现新版本 ${status.version}，下载完成后会自动重启。`;
    case 'downloading': return status.progress ? `正在下载 ${status.version} · ${Math.floor(status.progress.percent)}%` : '正在准备下载…';
    default: return status.message;
  }
}
const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function AppUpdatePanel({ disabled }: { disabled: boolean }) {
  const status = useAppUpdate();
  const { pending, error, run } = useAppUpdateAction();
  const action = status?.phase === 'error' ? status.retry : status?.phase === 'available' ? 'download' : 'check';
  const busy = pending || !status || ['checking', 'downloading', 'installing', 'unavailable'].includes(status.phase);
  return <section className="app-update-panel" aria-labelledby="app-update-heading">
    <h3 id="app-update-heading">版本更新</h3>
    <p role="status" aria-live="polite">{status ? describe(status) : '正在读取更新状态…'}</p>
    {status?.phase === 'downloading' ? <>
      <progress aria-label="更新下载进度" max={100} value={status.progress?.percent} />
      {status.progress ? <p className="app-update-meta">{size(status.progress.transferred)} / {size(status.progress.total)} · {size(status.progress.bytesPerSecond)}/秒</p> : null}
    </> : null}
    {status?.checkedAt ? <p className="app-update-meta">上次检查：{new Date(status.checkedAt).toLocaleString('zh-CN')}</p> : null}
    {error && error !== status?.message ? <p role="alert">{error}</p> : null}
    {status?.phase !== 'unavailable' && action ? <div className="modal-actions">
      <button type="button" className={`modal-button${action === 'check' ? '' : ' primary'}`} disabled={disabled || busy} onClick={() => void run(action)}>
        {status?.phase === 'checking' ? '检查中…' : status?.phase === 'downloading' ? '下载中…' : status?.phase === 'installing' ? '准备安装…'
          : status?.phase === 'error' ? `重试${action === 'check' ? '检查' : action === 'download' ? '下载' : '安装'}` : labels[action]}
      </button>
    </div> : null}
  </section>;
}
