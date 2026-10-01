import { useEffect, useMemo, useState } from 'react';
import { ON_MY_MAC_GROUP_NAMES, FEED_DISCOVERY_SOURCE_LABELS } from '../constants';
import { inferPrimaryGroupName } from '../utils';
import type { FeedRunDiagnostic, SourceEndpointHealth, XApiFallbackStatus } from '../types';
import { useDialogFeedback } from './feedback';
import type { DialogProps, OpmlPreviewState, FeedDiscoveryCandidate } from './types';

export function EditGroupDialog(props: DialogProps['edit-group']) {
const { group, groups, groupOptions } = props;
const { onClose, onChanged, notify } = props;
const { reportError, clearError, error } = useDialogFeedback(notify);
const [editingGroupId, setEditingGroupId] = useState<string | null>(group.id);
const [editGroupName, setEditGroupName] = useState(group.name);
const [editGroupParentId, setEditGroupParentId] = useState<string | null>(group.parentId);
const [updatingGroup, setUpdatingGroup] = useState(false);
const handleSubmitEditGroup = async () => {
    if (!window.catpaw || !editingGroupId || !editGroupName.trim()) return;
    setUpdatingGroup(true);
    clearError();
    try {
      const result = await window.catpaw.rss.updateGroup({
        id: editingGroupId,
        name: editGroupName.trim(),
        parentId: editGroupParentId,
      });
      if (!result.ok) {
        reportError('更新文件夹失败', result.error);
        return;
      }

      setEditingGroupId(null);
      setEditGroupName('');
      setEditGroupParentId(null);
      await onChanged();
      onClose();
    } catch (error) {
      reportError('更新文件夹失败', error);
    } finally {
      setUpdatingGroup(false);
    }
  };
const editingGroupParentOptions = useMemo(() => {
    if (!editingGroupId) return groupOptions;
    const childrenByParent = new Map<string, string[]>();
    for (const group of groups) {
      if (!group.parentId) continue;
      const children = childrenByParent.get(group.parentId) ?? [];
      children.push(group.id);
      childrenByParent.set(group.parentId, children);
    }
    const forbidden = new Set<string>([editingGroupId]);
    const visit = (groupId: string) => {
      for (const childId of childrenByParent.get(groupId) ?? []) {
        if (forbidden.has(childId)) continue;
        forbidden.add(childId);
        visit(childId);
      }
    };
    visit(editingGroupId);
    return groupOptions.filter((option) => !option.id || !forbidden.has(option.id));
  }, [editingGroupId, groupOptions, groups]);
return (
<div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
{error && <div className="reader-error" role="alert">{error}</div>}
            <div className="modal-body">
              <label className="modal-row">
                <span>名称:</span>
                <input
                  value={editGroupName}
                  onChange={(event) => setEditGroupName(event.target.value)}
                  autoFocus
                />
              </label>
              <label className="modal-row">
                <span>上级:</span>
                <select
                  value={editGroupParentId ?? ''}
                  onChange={(event) => setEditGroupParentId(event.target.value || null)}
                >
                  {editingGroupParentOptions.map((option) => (
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
                  setEditingGroupId(null);
                  setEditGroupName('');
                  setEditGroupParentId(null);
                }}
                disabled={updatingGroup}
              >
                取消
              </button>
              <button
                type="button"
                className="modal-button primary"
                onClick={handleSubmitEditGroup}
                disabled={updatingGroup || !editGroupName.trim()}
              >
                保存文件夹
              </button>
            </div>
          </div>
        </div>
);
}
