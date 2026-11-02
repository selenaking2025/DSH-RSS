import { useEffect, useState } from 'react';
import type { XApiFallbackStatus } from '../types';
import { useDialogFeedback } from './feedback';
import type { DialogProps } from './types';
import { FeedUrlChangeResult } from './FeedUrlChangeResult';

export function EditFeedDialog(props: DialogProps['edit-feed']) {
const { feed, groupOptions, onDelete: handleDeleteFeed, onHealth: openSourceHealth } = props;
const { onClose, onChanged } = props;
const { reportError, clearError, error } = useDialogFeedback();
const editingFeedId = feed.id;
const editingFeedOriginalUrl = feed.url;
const [editFeedUrl, setEditFeedUrl] = useState(feed.url);
const [editFeedName, setEditFeedName] = useState(feed.title ?? '');
const [editFeedFolderId, setEditFeedFolderId] = useState<string | null>(feed.groupId);
const [editFeedEnabled, setEditFeedEnabled] = useState(feed.enabled !== 0);
const [editFeedIntervalMinutes, setEditFeedIntervalMinutes] = useState<number | null>(feed.fetchIntervalMinutes ?? null);
const [updatingFeed, setUpdatingFeed] = useState(false);
const [savedChange, setSavedChange] = useState<{ backupPath: string; warning?: string } | null>(null);
const [xApiFallbackStatus, setXApiFallbackStatus] = useState<XApiFallbackStatus | null>(null);
const [updatingXApiFallback, setUpdatingXApiFallback] = useState(false);
const loadXApiFallbackStatus = async (feedId: string) => {
    if (!window.catpaw) return;
    try {
      setXApiFallbackStatus(await window.catpaw.rss.getXApiFallbackStatus(feedId));
    } catch (error) {
      setXApiFallbackStatus({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
const handleToggleXApiFallback = async () => {
    if (!window.catpaw || !editingFeedId || !xApiFallbackStatus || updatingXApiFallback) return;
    setUpdatingXApiFallback(true);
    clearError();
    try {
      const result = await window.catpaw.rss.setXApiFallbackEnabled({
        feedId: editingFeedId,
        enabled: !xApiFallbackStatus.enabled,
      });
      setXApiFallbackStatus(result);
      if (!result.ok) {
        reportError('更新实验性 X API 回退失败', result.error);
        return;
      }
      await onChanged();
    } catch (error) {
      reportError('更新实验性 X API 回退失败', error);
    } finally {
      setUpdatingXApiFallback(false);
    }
  };
const handleSubmitEditFeed = async () => {
    if (!window.catpaw || !editingFeedId || updatingFeed) return;
    if (!editFeedUrl.trim()) return;
    const urlChanged = editFeedUrl.trim() !== editingFeedOriginalUrl;
    if (
      urlChanged
      && !window.confirm(
        '确定修改这个订阅源的地址吗？已有文章、收藏、摘要和译文会保留。Catpaw 会先备份整个阅读库，再从新地址同步；备份失败则不修改。需要撤销时，可在「应用与数据 → 从备份恢复」中恢复修改前的完整阅读库。',
      )
    ) {
      return;
    }
    setUpdatingFeed(true);
    clearError();
    try {
      const result = await window.catpaw.rss.updateFeed({
        id: editingFeedId,
        url: editFeedUrl.trim(),
        title: editFeedName.trim() || null,
        groupId: editFeedFolderId ?? null,
        confirmUrlChange: urlChanged,
        enabled: editFeedEnabled,
        fetchIntervalMinutes: editFeedIntervalMinutes,
      });
      if (!result?.ok) {
        reportError('更新订阅源失败', result?.error);
        return;
      }
      if (result.backupPath) {
        setSavedChange({ backupPath: result.backupPath, warning: result.warning });
        await onChanged();
        return;
      }
      if (result.warning) {
        reportError('订阅源已更新，但首次同步需要留意', result.warning);
      }



      setEditFeedUrl('');
      setEditFeedName('');
      setEditFeedFolderId(null);
      setEditFeedEnabled(true);
      setEditFeedIntervalMinutes(null);
      await onChanged();
      onClose();
    } catch (error) {
      reportError('更新订阅源失败', error);
    } finally {
      setUpdatingFeed(false);
    }
  };

useEffect(() => { void loadXApiFallbackStatus(feed.id); }, [feed.id]);
if (savedChange) return <FeedUrlChangeResult {...savedChange} onClose={onClose} />;
return (
<div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
{error && <div className="reader-error" role="alert">{error}</div>}
            <div className="modal-body">
              <label className="modal-row">
                <span>URL:</span>
                <textarea
                  value={editFeedUrl}
                  onChange={(event) => setEditFeedUrl(event.target.value)}
                  placeholder="RSS / Atom 或 RSSHub 完整地址"
                  autoFocus
                />
              </label>
              <p>修改地址会保留已有文章、收藏、摘要和译文，并自动备份修改前的完整阅读库。</p>
              <label className="modal-row">
                <span>名称:</span>
                <input
                  value={editFeedName}
                  onChange={(event) => setEditFeedName(event.target.value)}
                  placeholder="可选"
                />
              </label>
              <label className="modal-row">
                <span>文件夹:</span>
                <select
                  value={editFeedFolderId ?? ''}
                  onChange={(event) => setEditFeedFolderId(event.target.value || null)}
                >
                  {groupOptions.map((option) => (
                    <option key={option.id ?? 'root'} value={option.id ?? ''}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="modal-row">
                <span>刷新:</span>
                <span className="modal-checkbox-line">
                  <input
                    type="checkbox"
                    checked={editFeedEnabled}
                    onChange={(event) => setEditFeedEnabled(event.target.checked)}
                  />
                  为该订阅源启用定时刷新
                </span>
              </label>
              <label className="modal-row">
                <span>间隔:</span>
                <select
                  value={editFeedIntervalMinutes ?? ''}
                  onChange={(event) => setEditFeedIntervalMinutes(event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">使用每日计划</option>
                  <option value="15">每 15 分钟</option>
                  <option value="30">每 30 分钟</option>
                  <option value="60">每小时</option>
                  <option value="180">每 3 小时</option>
                  <option value="360">每 6 小时</option>
                  <option value="720">每 12 小时</option>
                  <option value="1440">每天</option>
                </select>
              </label>
              {xApiFallbackStatus?.eligible && (
                <div className="source-policy-card">
                  <div>
                    <strong>实验性 X API 回退</strong>
                    <p>
                      仅在明确开启后生效。Catpaw 只在常规来源失败后才会使用它；调用 X API 可能消耗付费额度。
                    </p>
                    {!xApiFallbackStatus.configured && (
                      <p>Bearer Token 文件：{xApiFallbackStatus.tokenFilePath}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="modal-button ghost"
                    onClick={handleToggleXApiFallback}
                    disabled={updatingXApiFallback || (!xApiFallbackStatus.configured && !xApiFallbackStatus.enabled)}
                  >
                    {updatingXApiFallback
                      ? '正在更新…'
                      : xApiFallbackStatus.enabled
                        ? '关闭回退'
                        : '开启回退'}
                  </button>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-button ghost"
                onClick={() => {
                  onClose();
                  openSourceHealth(editingFeedId);
                }}
                disabled={updatingFeed}
              >
                订阅源健康
              </button>
              <button
                type="button"
                className="modal-button danger"
                onClick={() => {
                  void handleDeleteFeed(editingFeedId);
                }}
                disabled={updatingFeed}
              >
                删除订阅源
              </button>
              <button
                type="button"
                className="modal-button ghost"
                onClick={() => {
                  onClose();


                  setEditFeedUrl('');
                  setEditFeedName('');
                  setEditFeedFolderId(null);
                  setEditFeedEnabled(true);
                  setEditFeedIntervalMinutes(null);
                }}
                disabled={updatingFeed}
              >
                取消
              </button>
              <button
                type="button"
                className="modal-button primary"
                onClick={handleSubmitEditFeed}
                disabled={updatingFeed || !editFeedUrl.trim()}
              >
                {updatingFeed ? '正在保存并同步…' : '保存'}
              </button>
            </div>
          </div>
        </div>
);
}
