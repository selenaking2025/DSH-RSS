import { useEffect, useState } from 'react';
import type { FeedRunDiagnostic, SourceEndpointHealth } from '../types';
import { useDialogFeedback } from './feedback';
import type { DialogProps } from './types';

export function SourceHealthDialog(props: DialogProps['health']) {
const { feedId: sourceHealthFeedId, feedById, onRefresh: startRefresh, onDelete } = props;
const { onClose, onChanged, notify } = props;
const { reportError, clearError, error } = useDialogFeedback(notify);
const [sourceHealthRows, setSourceHealthRows] = useState<SourceEndpointHealth[]>([]);
const [sourceDiagnostics, setSourceDiagnostics] = useState<FeedRunDiagnostic[]>([]);
const [loadingSourceHealth, setLoadingSourceHealth] = useState(false);
const [retryingEndpointId, setRetryingEndpointId] = useState<string | null>(null);
const [deletingFeedId, setDeletingFeedId] = useState<string | null>(null);
const loadSourceHealth = async (feedId: string | null) => {
    if (!window.catpaw) return;
    setLoadingSourceHealth(true);
    try {
      const [health, diagnostics] = await Promise.all([
        window.catpaw.rss.listSourceEndpointHealth({ limit: 200 }),
        window.catpaw.rss.listFeedRunDiagnostics({ limit: 80 }),
      ]);
      setSourceHealthRows(feedId ? health.filter((row) => row.feedId === feedId) : health);
      setSourceDiagnostics(feedId ? diagnostics.filter((row) => row.feedId === feedId) : diagnostics);
    } catch (error) {
      reportError('载入订阅源健康失败', error);
    } finally {
      setLoadingSourceHealth(false);
    }
  };
const handleResetAndRetryEndpoint = async (row: SourceEndpointHealth) => {
    if (!window.catpaw || retryingEndpointId || deletingFeedId) return;
    setRetryingEndpointId(row.endpointId);
    clearError();
    try {
      const reset = await window.catpaw.rss.resetSourceEndpointHealth(row.endpointId);
      if (!reset.ok) {
        reportError('重置端点失败', reset.error);
        return;
      }
      await startRefresh([row.feedId]);
      await Promise.all([loadSourceHealth(sourceHealthFeedId), onChanged()]);
    } catch (error) {
      reportError('重试端点失败', error);
    } finally {
      setRetryingEndpointId(null);
    }
  };

const handleDeleteSource = async (row: SourceEndpointHealth) => {
    if (deletingFeedId || retryingEndpointId) return;
    setDeletingFeedId(row.feedId);
    clearError();
    try {
      const result = await onDelete(row.feedId);
      if (result?.ok) {
        setSourceHealthRows((rows) => rows.filter((item) => item.feedId !== row.feedId));
        setSourceDiagnostics((rows) => rows.filter((item) => item.feedId !== row.feedId));
      } else if (result) {
        reportError('删除订阅源失败', result.error);
      }
    } catch (error) {
      reportError('删除订阅源失败', error);
    } finally {
      setDeletingFeedId(null);
    }
  };

useEffect(() => { void loadSourceHealth(sourceHealthFeedId); }, [sourceHealthFeedId]);
return (
<div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card source-health-modal">
{error && <div className="reader-error" role="alert">{error}</div>}
            <div className="source-health-header">
              <div>
                <h2>订阅源健康</h2>
                <p>
                  {sourceHealthFeedId
                    ? `${feedById.get(sourceHealthFeedId)?.title ?? feedById.get(sourceHealthFeedId)?.url ?? '该订阅源'} 的端点与近期运行记录。`
                    : '全部订阅源的端点与近期刷新诊断。'}
                </p>
              </div>
              <button type="button" className="modal-button ghost" onClick={() => onClose()}>
                关闭
              </button>
            </div>
            {loadingSourceHealth ? (
              <div className="source-health-empty">正在载入订阅源健康…</div>
            ) : (
              <div className="source-health-content">
                <section>
                  <h3>端点</h3>
                  {sourceHealthRows.length === 0 ? (
                    <div className="source-health-empty">没有找到端点记录。</div>
                  ) : (
                    <div className="source-health-list">
                      {sourceHealthRows.map((row) => (
                        <div key={row.endpointId} className="source-health-row" data-feed-id={row.feedId}>
                          <span className={`reader-sync-dot ${row.endpointStatus}`} aria-hidden="true" />
                          <div className="source-health-main">
                            <strong>{row.feedTitle ?? row.feedUrl}</strong>
                            <span>
                              {row.endpointRole} · {row.providerType} · {row.endpointHost ?? row.endpointUrl}
                              {row.managedBy === 'user' ? ' · 用户锁定' : ''}
                            </span>
                            {row.lastError && <span className="source-health-error">{row.lastError}</span>}
                          </div>
                          <div className="source-health-side">
                            <span>{row.endpointStatus}</span>
                            <div className="source-health-actions">
                              <button
                                type="button"
                                className="modal-button ghost"
                                onClick={() => {
                                  void handleResetAndRetryEndpoint(row);
                                }}
                                disabled={Boolean(retryingEndpointId || deletingFeedId)}
                              >
                                {retryingEndpointId === row.endpointId ? '正在重试…' : '重置并重试'}
                              </button>
                              <button
                                type="button"
                                className="modal-button danger"
                                onClick={() => { void handleDeleteSource(row); }}
                                disabled={Boolean(retryingEndpointId || deletingFeedId)}
                              >
                                {deletingFeedId === row.feedId ? '正在删除…' : '删除订阅源'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <section>
                  <h3>近期运行</h3>
                  {sourceDiagnostics.length === 0 ? (
                    <div className="source-health-empty">暂无近期运行诊断。</div>
                  ) : (
                    <div className="source-diagnostic-list">
                      {sourceDiagnostics.slice(0, 30).map((row) => (
                        <div key={row.id} className="source-diagnostic-row">
                          <span className={`source-run-status ${row.status}`}>{row.status}</span>
                          <span>{row.feedTitle ?? row.feedUrl}</span>
                          <span>{row.providerType ?? '未知'} · {row.runType}</span>
                          <span>{new Date(row.finishedAt).toLocaleString()}</span>
                          {row.error && <span className="source-health-error">{row.error}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
);
}
