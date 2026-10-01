import { useEffect, useMemo, useState } from 'react';
import { ON_MY_MAC_GROUP_NAMES, FEED_DISCOVERY_SOURCE_LABELS } from '../constants';
import { inferPrimaryGroupName } from '../utils';
import type { FeedRunDiagnostic, SourceEndpointHealth, XApiFallbackStatus } from '../types';
import { useDialogFeedback } from './feedback';
import type { DialogProps, OpmlPreviewState, FeedDiscoveryCandidate } from './types';
import { useMaintenanceProgress } from '../useMaintenanceProgress';

export function ImportSubscriptionDialog(props: DialogProps['import']) {
const { aiNewsGroupId, primaryGroupIdByName, groupOptions, onImported } = props;
const { onClose, onChanged, notify } = props;
const { reportError, clearError, error } = useDialogFeedback(notify);
const [importSubscriptionFolderId, setImportSubscriptionFolderId] = useState<string | null>(null);
const [importSubscriptionCategoryTouched, setImportSubscriptionCategoryTouched] = useState(false);
const [importingSubscription, setImportingSubscription] = useState(false);
const progress = useMaintenanceProgress(importingSubscription);
const [opmlPreview, setOpmlPreview] = useState<OpmlPreviewState | null>(null);
const handlePreviewOpml = async (groupId: string | null, token?: string | null) => {
    if (!window.catpaw) {
      reportError('OPML 预览失败', 'IPC 不可用');
      return { ok: false, error: 'IPC_NOT_AVAILABLE' as const };
    }
    clearError();
    try {
      const result = await window.catpaw.rss.previewOpml({ groupId, token: token ?? null });
      if (result.ok && result.token) {
        setOpmlPreview({
          token: result.token,
          fileName: result.fileName ?? '已选择的 OPML 文件',
          newGroupCount: result.newGroupCount ?? 0,
          reusedGroupCount: result.reusedGroupCount ?? 0,
          newFeedCount: result.newFeedCount ?? 0,
          existingFeedCount: result.existingFeedCount ?? 0,
          duplicateFeedCount: result.duplicateFeedCount ?? 0,
          invalidFeedCount: result.invalidFeedCount ?? 0,
        });
      } else if (result.error && result.error !== 'CANCELLED') {
        reportError('OPML 预览失败', result.error);
      }
      return result;
    } catch (error) {
      reportError('OPML 预览失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
const handleImportOpml = async (groupId: string | null, token: string) => {
    if (!window.catpaw) return { ok: false, error: 'IPC_NOT_AVAILABLE' as const };
    clearError();
    try {
      const result = await window.catpaw.rss.importOpml({ groupId, token });
      if (result.ok) {
        await onChanged();
        const importedFeedIds = result.feedIds?.length ? result.feedIds : [];
        if (importedFeedIds.length > 0) {
          void onImported(importedFeedIds);
        }
      } else if (result.error && result.error !== 'CANCELLED') {
        reportError('导入失败', result.error);
      }
      return result;
    } catch (error) {
      reportError('导入失败', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
const handleImportFolderChange = async (groupId: string | null) => {
    setImportSubscriptionFolderId(groupId);
    setImportSubscriptionCategoryTouched(true);
    if (!opmlPreview || importingSubscription) return;
    setImportingSubscription(true);
    try {
      await handlePreviewOpml(groupId, opmlPreview.token);
    } finally {
      setImportingSubscription(false);
    }
  };
const handleConfirmImportSubscription = async () => {
    if (importingSubscription) return;
    setImportingSubscription(true);
    try {
      if (!opmlPreview) {
        await handlePreviewOpml(importSubscriptionFolderId);
        return;
      }
      const result = await handleImportOpml(importSubscriptionFolderId, opmlPreview.token);
      if (result?.ok) {
        onClose();
        setImportSubscriptionCategoryTouched(false);
        setImportSubscriptionFolderId(aiNewsGroupId);
        setOpmlPreview(null);
      }
    } finally {
      setImportingSubscription(false);
    }
  };
const activeImportPrimaryGroupName = useMemo(() => {
    for (const name of ON_MY_MAC_GROUP_NAMES) {
      const groupId = primaryGroupIdByName.get(name);
      if (groupId && groupId === importSubscriptionFolderId) return name;
    }
    return null;
  }, [importSubscriptionFolderId, primaryGroupIdByName]);
useEffect(() => {
    if (!true) return;
    if (importSubscriptionCategoryTouched) return;
    const defaultGroupId = aiNewsGroupId;
    if (!defaultGroupId) return;
    if (importSubscriptionFolderId === defaultGroupId) return;
    setImportSubscriptionFolderId(defaultGroupId);
  }, [
    aiNewsGroupId,
    importSubscriptionCategoryTouched,
    importSubscriptionFolderId,
    true,
  ]);
return (
<div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
{error && <div className="reader-error" role="alert">{error}</div>}
            <div className="modal-body">
              <label className="modal-row">
                <span>分类:</span>
                <div className="modal-category-picker">
                  <div className="modal-category-chips">
                    {ON_MY_MAC_GROUP_NAMES.map((groupName) => {
                      const groupId = primaryGroupIdByName.get(groupName) ?? null;
                      const isActive = Boolean(groupId && groupId === importSubscriptionFolderId);
                      return (
                        <button
                          key={groupName}
                          type="button"
                          className={`modal-category-chip${isActive ? ' active' : ''}`}
                          onClick={() => {
                            if (!groupId) return;
                            void handleImportFolderChange(groupId);
                          }}
                          disabled={!groupId || importingSubscription}
                        >
                          {groupName}
                        </button>
                      );
                    })}
                  </div>
                  <div className="modal-category-hint">
                    {importSubscriptionCategoryTouched
                      ? `已手动选择：${activeImportPrimaryGroupName ?? '自定义分组'}`
                      : `默认分类：${activeImportPrimaryGroupName ?? 'AI资讯'}`}
                  </div>
                </div>
              </label>
              <label className="modal-row">
                <span>文件夹:</span>
                <select
                  value={importSubscriptionFolderId ?? ''}
                  onChange={(event) => {
                    void handleImportFolderChange(event.target.value || null);
                  }}
                  disabled={importingSubscription}
                >
                  {groupOptions.map((option) => (
                    <option key={option.id ?? 'root'} value={option.id ?? ''}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {opmlPreview && (
                <div className="opml-preview" role="status">
                  <div className="opml-preview-title">{opmlPreview.fileName}</div>
                  <div className="opml-preview-grid">
                    <span><strong>{opmlPreview.newFeedCount}</strong> 个新订阅源</span>
                    <span><strong>{opmlPreview.newGroupCount}</strong> 个新文件夹</span>
                    <span><strong>{opmlPreview.existingFeedCount}</strong> 个已订阅</span>
                    <span><strong>{opmlPreview.reusedGroupCount}</strong> 个文件夹可复用</span>
                    <span><strong>{opmlPreview.duplicateFeedCount}</strong> 个文件内重复</span>
                    <span><strong>{opmlPreview.invalidFeedCount}</strong> 个无效条目</span>
                  </div>
                  <div className="opml-preview-note">
                    已有订阅不会被改动。重复和无效条目会被跳过，嵌套的文件夹结构会保留。
                  </div>
                </div>
              )}
              {importingSubscription && <p role="status">{progress}</p>}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-button ghost"
                onClick={() => {
                  onClose();
                  setImportSubscriptionCategoryTouched(false);
                  setOpmlPreview(null);
                }}
                disabled={importingSubscription}
              >
                取消
              </button>
              <button
                type="button"
                className="modal-button primary"
                onClick={handleConfirmImportSubscription}
                disabled={importingSubscription}
              >
                {importingSubscription
                  ? '正在处理…'
                  : opmlPreview
                    ? `导入 ${opmlPreview.newFeedCount} 个新订阅源`
                    : '选择 OPML 并预览'}
              </button>
            </div>
          </div>
        </div>
);
}
