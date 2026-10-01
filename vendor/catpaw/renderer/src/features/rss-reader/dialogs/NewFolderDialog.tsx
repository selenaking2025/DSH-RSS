import { useEffect, useMemo, useState } from 'react';
import { ON_MY_MAC_GROUP_NAMES, FEED_DISCOVERY_SOURCE_LABELS } from '../constants';
import { inferPrimaryGroupName } from '../utils';
import type { FeedRunDiagnostic, SourceEndpointHealth, XApiFallbackStatus } from '../types';
import { useDialogFeedback } from './feedback';
import type { DialogProps, OpmlPreviewState, FeedDiscoveryCandidate } from './types';

export function NewFolderDialog(props: DialogProps['new-folder']) {
const { groupOptions, parentId } = props;
const { onClose, onChanged, notify } = props;
const { reportError, clearError, error } = useDialogFeedback(notify);
const [newFolderName, setNewFolderName] = useState('');
const [newFolderParentId, setNewFolderParentId] = useState<string | null>(parentId);
const [creatingFolder, setCreatingFolder] = useState(false);
const handleSubmitNewFolder = async () => {
    if (!window.catpaw) return;
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    clearError();
    try {
      await window.catpaw.rss.createGroup(newFolderName.trim(), newFolderParentId);

      setNewFolderName('');
      setNewFolderParentId(null);
      await onChanged();
      onClose();
    } catch (error) {
      reportError('新建文件夹失败', error);
    } finally {
      setCreatingFolder(false);
    }
  };

return (
<div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
{error && <div className="reader-error" role="alert">{error}</div>}
            <div className="modal-body">
              <label className="modal-row">
                <span>文件夹名称:</span>
                <input
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder=""
                  autoFocus
                />
              </label>
              <label className="modal-row">
                <span>上级:</span>
                <select
                  value={newFolderParentId ?? ''}
                  onChange={(event) => setNewFolderParentId(event.target.value || null)}
                >
                  {groupOptions.map((option) => (
                    <option key={option.id ?? 'root'} value={option.id ?? ''}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-button ghost"
                onClick={() => {
                  onClose();
                  setNewFolderName('');
                  setNewFolderParentId(null);
                }}
                disabled={creatingFolder}
              >
                取消
              </button>
              <button
                type="button"
                className="modal-button primary"
                onClick={handleSubmitNewFolder}
                disabled={creatingFolder || !newFolderName.trim()}
              >
                创建文件夹
              </button>
            </div>
          </div>
        </div>
);
}
