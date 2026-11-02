import { useState } from 'react';
import { friendlyReaderError } from '../errors';

export function FeedUrlChangeResult({ backupPath, warning, onClose }: {
  backupPath: string; warning?: string; onClose: () => void;
}) {
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');
  const restore = async () => {
    if (restoring) return;
    setRestoring(true); setError('');
    try {
      const result = await window.catpaw!.rss.restoreDatabase();
      if (!result.ok && result.error !== 'CANCELLED') setError(friendlyReaderError(result.error));
    } catch (error) { setError(friendlyReaderError(error)); }
    finally { setRestoring(false); }
  };
  return <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="feed-url-result-title">
    <div className="modal-card">
      <div className="modal-body">
        <h2 id="feed-url-result-title">订阅地址已更新</h2>
        <p>已有文章、收藏、摘要和译文未被清空，修改前的完整备份已保存。</p>
        {warning && <p role="alert">{warning === 'CANCELLED' ? '首次同步已取消，已有阅读数据仍然保留。' : `首次同步未完成：${friendlyReaderError(warning)}`}</p>}
        <p>需要恢复原地址或修改前的文章版本时，点击「从备份恢复」，选择这份备份：</p>
        <p style={{ overflowWrap: 'anywhere' }}>{backupPath}</p>
        <p>恢复会将整个阅读库回退到备份时的状态。当前数据会先另存一份备份，然后重启。关闭此窗口后，也可从「应用与数据 → 从备份恢复」进入。</p>
        {error && <p className="reader-error" role="alert">{error}</p>}
      </div>
      <div className="modal-actions">
        <button className="modal-button" disabled={restoring} onClick={() => void restore()}>从备份恢复</button>
        <button className="modal-button primary" disabled={restoring} onClick={onClose}>完成</button>
      </div>
    </div>
  </div>;
}
