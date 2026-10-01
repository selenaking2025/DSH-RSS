import { useState } from 'react';
import { useAppUpdate, useAppUpdateAction } from './useAppUpdate';

export function AppUpdateNotice() {
  const status = useAppUpdate();
  const [dismissed, setDismissed] = useState('');
  const { pending, error, run } = useAppUpdateAction();
  if (!status || status.phase !== 'available') return null;
  const key = `${status.phase}:${status.version}`;
  if (dismissed === key) return null;
  return <div className="reader-banner app-update-notice" role="status">
    <span>{error || `Catpaw ${status.version} 已发布，下载完成后会自动重启。`}</span>
    <div className="reader-banner-actions">
      <button type="button" disabled={pending} onClick={() => void run('download')}>下载并重启</button>
      <button type="button" onClick={() => setDismissed(key)}>稍后</button>
    </div>
  </div>;
}
