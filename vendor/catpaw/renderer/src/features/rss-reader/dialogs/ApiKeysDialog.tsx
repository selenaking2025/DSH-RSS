import { useEffect, useState } from 'react';
import { MODEL_PROVIDER_PRESETS, type ModelProvider } from '../../../../../electron/contracts/model-providers';
import { ProviderEditor } from '../model-providers/ProviderEditor';
import { ReaderIcon } from '../ReaderIcon';
import type { DialogProps } from './types';
import '../model-providers/model-providers.css';

type Editor = { kind: 'builtin'; id: string } | { kind: 'custom'; id?: string };

export function ApiKeysDialog({ onClose }: DialogProps['api-keys']) {
  const [providers, setProviders] = useState<ModelProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    if (typeof window.catpaw?.rss.listModelProviders !== 'function') {
      setError('配置功能已更新，请重启 Catpaw 后使用。');
      return;
    }
    void window.catpaw.rss.listModelProviders().then((result) => {
      if (!active) return;
      if (result.ok) setProviders(result.data);
      else setError(result.error);
    }).catch(() => { if (active) setError('无法读取模型配置，请重试。'); });
    return () => { active = false; };
  }, [reload]);

  const addable = MODEL_PROVIDER_PRESETS.filter((preset) => !providers?.some((provider) => provider.id === preset.id));
  const editingProvider = providers?.find((provider) => provider.id === editor?.id);
  const preset = editor?.kind === 'builtin' ? MODEL_PROVIDER_PRESETS.find((preset) => preset.id === editor.id) : undefined;
  function openEditor(value: Editor) { setEditor(value); setRemoveId(null); setNotice(null); setError(null); }

  async function remove(provider: ModelProvider) {
    setBusy(true); setError(null);
    try {
      const result = await window.catpaw!.rss.removeModelProvider(provider.id);
      if (result.ok) {
        setProviders(result.data); setRemoveId(null);
        setNotice(`${provider.displayName} 已移除。`);
        if (editor?.id === provider.id) setEditor(null);
      } else setError(result.error);
    } catch { setError('移除提供方失败，请重试。'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="api-keys-title"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation(); event.preventDefault();
        if (busy) return;
        if (removeId) setRemoveId(null);
        else if (editor) setEditor(null);
        else onClose();
      }}>
      <div className="modal-card api-keys-modal">
        <header className="api-keys-header">
          <div><span className="api-keys-eyebrow">API Key</span><h2 id="api-keys-title">模型提供方</h2></div>
          <button type="button" className="provider-close" aria-label="关闭 API Key 设置" disabled={busy} onClick={onClose}><ReaderIcon name="close" /></button>
        </header>
        <p className="api-keys-description">添加预设提供方或自定义 API，管理密钥和模型。密钥仅加密保存在本机。</p>
        {notice ? <p className="provider-notice" role="status">{notice}</p> : null}
        {error ? <div className="reader-error" role="alert">{error}{providers === null ? <button className="modal-button" onClick={() => setReload((value) => value + 1)}>重新加载</button> : null}</div> : null}
        {providers === null ? !error ? <p className="provider-muted" role="status">正在读取模型提供方…</p> : null : (
          <>
            {providers.length ? (
              <ul className="provider-list" aria-label="已添加的模型提供方">
                {providers.map((provider) => (
                  <li className="provider-row" key={provider.id}>
                    <div className="provider-row-info">
                      <div className="provider-row-name"><strong>{provider.displayName}</strong>{provider.kind === 'custom' ? <span className="provider-badge">自定义</span> : null}</div>
                      <div className="provider-row-meta">
                        <span className={provider.keyConfigured ? 'provider-key-saved' : ''}>{provider.keyNeedsReentry ? '需重新输入 API Key' : provider.keyConfigured ? '✓ 密钥已保存' : '未设置密钥'}</span>
                        <span aria-hidden="true">·</span><span>{provider.models.length} 个模型</span><span aria-hidden="true">·</span><span>{provider.id}</span>
                      </div>
                    </div>
                    <div className="provider-row-actions">
                      <button className="modal-button" type="button" disabled={busy} aria-label={`编辑 ${provider.displayName}`}
                        aria-pressed={editor?.id === provider.id} onClick={() => openEditor({ kind: provider.kind, id: provider.id })}>编辑</button>
                      <button className="modal-button provider-remove" type="button" disabled={busy} aria-label={`移除 ${provider.displayName}`}
                        onClick={() => { setRemoveId(provider.id); setEditor(null); setNotice(null); }}>移除</button>
                    </div>
                    {removeId === provider.id ? (
                      <div className="provider-remove-confirm">
                        <p>移除 {provider.displayName} 及其已保存的密钥和模型？</p>
                        <button className="modal-button" type="button" disabled={busy} onClick={() => setRemoveId(null)}>取消移除</button>
                        <button className="modal-button provider-remove" type="button" disabled={busy} onClick={() => void remove(provider)}>确认移除</button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : !editor ? <div className="provider-empty"><strong>还没有添加模型提供方</strong><p>选择常用提供方，或连接你自己的模型服务。</p></div> : null}
            <div className="provider-add-actions">
              <button type="button" className="modal-button" disabled={busy || !addable.length} onClick={() => openEditor({ kind: 'builtin', id: addable[0].id })}>
                <ReaderIcon name="plus" />添加提供方
              </button>
              <button type="button" className="modal-button" disabled={busy} onClick={() => openEditor({ kind: 'custom' })}>
                <ReaderIcon name="plus" />添加自定义提供方
              </button>
            </div>
            {editor ? (
              <div className="provider-editor-section">
                {editor.kind === 'builtin' && !editingProvider ? (
                  <label className="provider-field provider-preset-picker">提供方
                    <select aria-label="提供方" value={editor.id} disabled={busy} onChange={(event) => openEditor({ kind: 'builtin', id: event.target.value })}>
                      {addable.map((preset) => <option key={preset.id} value={preset.id}>{preset.displayName}</option>)}
                    </select>
                  </label>
                ) : null}
                <ProviderEditor key={editor.id ?? 'new-custom'} provider={editingProvider} preset={preset} onBusy={setBusy}
                  onCancel={() => setEditor(null)} onSaved={(next, name) => { setProviders(next); setEditor(null); setNotice(`${name} 已保存。`); }} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
