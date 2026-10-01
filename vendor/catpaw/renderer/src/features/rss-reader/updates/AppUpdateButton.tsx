import { ReaderIcon } from '../ReaderIcon';
import { useAppUpdate, useAppUpdateAction } from './useAppUpdate';

export function AppUpdateButton() {
  const status = useAppUpdate();
  const { pending, error, run } = useAppUpdateAction();
  if (!status) return null;
  const retryingUpdate = status.phase === 'error' && (status.retry === 'download' || status.retry === 'install');
  if (!['available', 'downloading', 'installing'].includes(status.phase) && !retryingUpdate) return null;

  const busy = status.phase === 'downloading' || status.phase === 'installing';
  const version = status.version ? ` ${status.version}` : '';
  const percent = status.progress ? Math.floor(status.progress.percent) : undefined;
  const action = status.retry === 'install' ? 'install' : 'download';
  const description = status.phase === 'installing' ? status.message ?? '正在准备重启…'
    : status.phase === 'downloading' ? '正在下载更新'
    : retryingUpdate || error ? '更新未完成，点击重试' : '';
  const label = busy ? `${description}${percent !== undefined ? ` ${percent}%` : ''}`
    : action === 'install' ? '重试安装更新，完成后自动重启'
    : `${retryingUpdate || error ? '重试下载更新' : `下载新版本${version}`}，完成后自动重启`;

  return <>
    <button type="button" className="icon-button reader-update-button"
      data-state={status.phase} aria-label={label} title={label}
      disabled={busy || pending} onClick={() => void run(action)}>
      <ReaderIcon name="download" />
      {!busy ? <span className="reader-update-dot" aria-hidden="true" /> : null}
    </button>
    {description ? <div className="reader-update-status">
      <div className="reader-update-status-line"><span role="status">{description}</span>
        {percent !== undefined ? <span aria-hidden="true">{percent}%</span> : null}</div>
      {status.phase === 'downloading' ? <>
        <progress aria-label="应用更新下载进度" max={100} value={status.progress?.percent} />
        <span className="reader-update-hint">下载完成后自动重启</span>
      </> : null}
      {retryingUpdate || error ? <span className="reader-update-hint">{error || status.message}</span> : null}
    </div> : null}
  </>;
}
