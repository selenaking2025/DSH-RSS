import { useEffect, useMemo, useState } from 'react';
import { ON_MY_MAC_GROUP_NAMES, FEED_DISCOVERY_SOURCE_LABELS } from '../constants';
import { inferPrimaryGroupName } from '../utils';
import type { FeedRunDiagnostic, SourceEndpointHealth, XApiFallbackStatus } from '../types';
import { useDialogFeedback } from './feedback';
import type { DialogProps, OpmlPreviewState, FeedDiscoveryCandidate } from './types';

export function AddFeedDialog(props: DialogProps['add']) {
const { aiNewsGroupId, primaryGroupIdByName, groupOptions } = props;
const { onClose, onChanged, notify } = props;
const { reportError, clearError, error } = useDialogFeedback(notify);
const [newFeedUrl, setNewFeedUrl] = useState('');
const [newFeedName, setNewFeedName] = useState('');
const [newFeedFolderId, setNewFeedFolderId] = useState<string | null>(null);
const [newFeedCategoryTouched, setNewFeedCategoryTouched] = useState(false);
const [feedDiscoveryCandidates, setFeedDiscoveryCandidates] = useState<FeedDiscoveryCandidate[]>([]);
const [selectedFeedCandidateUrl, setSelectedFeedCandidateUrl] = useState<string | null>(null);
const [discoveringFeed, setDiscoveringFeed] = useState(false);
const [addingFeed, setAddingFeed] = useState(false);
const handleDiscoverNewFeed = async () => {
    if (!window.catpaw || !newFeedUrl.trim() || discoveringFeed) return;
    setDiscoveringFeed(true);
    clearError();
    try {
      const result = await window.catpaw.rss.discoverFeeds(newFeedUrl.trim());
      if (!result.ok) {
        reportError('查找订阅源失败', result.error);
        return;
      }
      setFeedDiscoveryCandidates(result.candidates);
      const first = result.candidates[0] ?? null;
      setSelectedFeedCandidateUrl(first?.url ?? null);
      if (first?.title && !newFeedName.trim()) setNewFeedName(first.title);
      if (result.candidates.length === 0) {
        reportError('没有找到订阅源', '这个页面没有声明 RSS 或 Atom 订阅地址。');
      } else if (result.warning) {
        reportError('找到候选订阅源，但校验结果需要留意', result.warning);
      }
    } catch (error) {
      reportError('查找订阅源失败', error);
    } finally {
      setDiscoveringFeed(false);
    }
  };
const handleSubmitNewFeed = async () => {
    if (!window.catpaw) return;
    const selectedCandidate = feedDiscoveryCandidates.find((candidate) => candidate.url === selectedFeedCandidateUrl);
    if (!selectedCandidate) return;
    setAddingFeed(true);
    clearError();
    try {
      const result = await window.catpaw.rss.addFeed({
        url: selectedCandidate.url,
        title: newFeedName.trim() || selectedCandidate.title || null,
        groupId: newFeedFolderId ?? null,
      });
      if (!result?.ok) {
        reportError('添加订阅源失败', result?.error);
        return;
      }
      if (result.warning) {
        reportError('订阅源已添加，但有警告', result.warning);
      }

      setNewFeedUrl('');
      setNewFeedName('');
      setNewFeedCategoryTouched(false);
      setNewFeedFolderId(aiNewsGroupId);
      setFeedDiscoveryCandidates([]);
      setSelectedFeedCandidateUrl(null);
      await onChanged();
      onClose();
    } catch (error) {
      reportError('添加订阅源失败', error);
    } finally {
      setAddingFeed(false);
    }
  };
const suggestedNewFeedGroupName = useMemo(
    () => inferPrimaryGroupName({ url: newFeedUrl, title: newFeedName }),
    [newFeedName, newFeedUrl],
  );
const activeNewFeedPrimaryGroupName = useMemo(() => {
    for (const name of ON_MY_MAC_GROUP_NAMES) {
      const groupId = primaryGroupIdByName.get(name);
      if (groupId && groupId === newFeedFolderId) return name;
    }
    return null;
  }, [newFeedFolderId, primaryGroupIdByName]);
useEffect(() => {
    if (!true) return;
    if (newFeedCategoryTouched) return;
    const suggestedGroupId = primaryGroupIdByName.get(suggestedNewFeedGroupName) ?? aiNewsGroupId;
    if (!suggestedGroupId) return;
    if (newFeedFolderId === suggestedGroupId) return;
    setNewFeedFolderId(suggestedGroupId);
  }, [
    aiNewsGroupId,
    newFeedCategoryTouched,
    newFeedFolderId,
    primaryGroupIdByName,
    true,
    suggestedNewFeedGroupName,
  ]);
return (
<div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
{error && <div className="reader-error" role="alert">{error}</div>}
            <div className="modal-body">
              <label className="modal-row">
                <span>订阅地址:</span>
                <textarea
                  value={newFeedUrl}
                  onChange={(event) => {
                    setNewFeedUrl(event.target.value);
                    setFeedDiscoveryCandidates([]);
                    setSelectedFeedCandidateUrl(null);
                  }}
                  placeholder="网站、RSS / Atom 或 RSSHub 完整地址"
                  autoFocus
                />
              </label>
              <p className="modal-help">支持 RSSHub，包括自建实例。粘贴完整的 http(s) 订阅地址后查找订阅源。</p>
              {feedDiscoveryCandidates.length > 0 && (
                <div className="feed-discovery-results">
                  <div className="feed-discovery-title">发现的订阅源</div>
                  {feedDiscoveryCandidates.map((candidate) => (
                    <button
                      key={candidate.url}
                      type="button"
                      className={`feed-discovery-candidate${selectedFeedCandidateUrl === candidate.url ? ' active' : ''}`}
                      onClick={() => {
                        setSelectedFeedCandidateUrl(candidate.url);
                        if (candidate.title && !newFeedName.trim()) setNewFeedName(candidate.title);
                      }}
                    >
                      <span>
                        <strong>{candidate.title ?? candidate.url}</strong>
                        {candidate.title && <small>{candidate.url}</small>}
                      </span>
                      <em>{FEED_DISCOVERY_SOURCE_LABELS[candidate.source] ?? candidate.source}</em>
                    </button>
                  ))}
                </div>
              )}
              <label className="modal-row">
                <span>名称:</span>
                <input
                  value={newFeedName}
                  onChange={(event) => setNewFeedName(event.target.value)}
                  placeholder="可选"
                />
              </label>
              <label className="modal-row">
                <span>分类:</span>
                <div className="modal-category-picker">
                  <div className="modal-category-chips">
                    {ON_MY_MAC_GROUP_NAMES.map((groupName) => {
                      const groupId = primaryGroupIdByName.get(groupName) ?? null;
                      const isActive = Boolean(groupId && groupId === newFeedFolderId);
                      return (
                        <button
                          key={groupName}
                          type="button"
                          className={`modal-category-chip${isActive ? ' active' : ''}`}
                          onClick={() => {
                            if (!groupId) return;
                            setNewFeedFolderId(groupId);
                            setNewFeedCategoryTouched(true);
                          }}
                          disabled={!groupId}
                        >
                          {groupName}
                        </button>
                      );
                    })}
                  </div>
                  <div className="modal-category-hint">
                    {newFeedCategoryTouched
                      ? `已手动选择：${activeNewFeedPrimaryGroupName ?? '自定义分组'}`
                      : `自动推荐：${suggestedNewFeedGroupName}`}
                  </div>
                </div>
              </label>
              <label className="modal-row">
                <span>文件夹:</span>
                <select
                  value={newFeedFolderId ?? ''}
                  onChange={(event) => {
                    setNewFeedFolderId(event.target.value || null);
                    setNewFeedCategoryTouched(true);
                  }}
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
                  setNewFeedCategoryTouched(false);
                  setFeedDiscoveryCandidates([]);
                  setSelectedFeedCandidateUrl(null);
                }}
                disabled={addingFeed || discoveringFeed}
              >
                取消
              </button>
              <button
                type="button"
                className="modal-button primary"
                onClick={feedDiscoveryCandidates.length > 0 ? handleSubmitNewFeed : handleDiscoverNewFeed}
                disabled={
                  addingFeed
                  || discoveringFeed
                  || !newFeedUrl.trim()
                  || (feedDiscoveryCandidates.length > 0 && !selectedFeedCandidateUrl)
                }
              >
                {addingFeed
                  ? '正在添加…'
                  : discoveringFeed
                    ? '正在查找订阅源…'
                    : feedDiscoveryCandidates.length > 0
                      ? '添加所选订阅源'
                      : '查找订阅源'}
              </button>
            </div>
          </div>
        </div>
);
}
