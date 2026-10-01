import { useEffect, useState, type ReactNode } from 'react';
import type { ModelProvider } from '../../../../../electron/contracts/model-providers';
import { modelSelectionKey } from './model-selection';
import './model-settings.css';

type Props = {
  kind: 'translation' | 'summary';
  modelKey: string;
  description: string;
  children?: ReactNode;
  onSave: (modelKey: string) => void;
  onConfigureApiKeys: () => void;
  onClose: () => void;
};

export function ModelSettingsDialog(props: Props) {
  const label = props.kind === 'translation' ? '翻译' : '摘要';
  const titleId = `${props.kind}-settings-title`;
  const [modelKey, setModelKey] = useState(props.modelKey);
  const [providers, setProviders] = useState<ModelProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      if (result.ok) setProviders(result.data.filter((provider) => provider.models.length));
      else setError(result.error);
    }).catch(() => { if (active) setError(`无法读取${label}模型，请重试。`); });
    return () => { active = false; };
  }, [reload, label]);

  const availableKeys = providers?.flatMap((provider) => provider.models.map((model) => modelSelectionKey(provider.id, model))) ?? [];
  const selectedModelKey = availableKeys.includes(modelKey) ? modelKey : availableKeys[0] ?? '';
  function save() {
    try {
      props.onSave(selectedModelKey || modelKey);
      props.onClose();
    } catch { setError(`保存${label}设置失败，请重试。`); }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={`modal-card model-settings-modal ${props.kind}-settings-modal`}>
        <div className="modal-body">
          <div className="model-settings-heading">
            <h2 id={titleId}>{label}设置</h2>
            <p>{props.description}</p>
          </div>
          {error ? <div className="reader-error" role="alert">{error}{providers === null ? <button type="button" className="modal-button" onClick={() => setReload((value) => value + 1)}>重新加载</button> : null}</div> : null}
          {props.children}
          <label className="modal-row">
            <span>{label}模型</span>
            <select aria-label={`${label}模型`} value={selectedModelKey} disabled={!availableKeys.length} onChange={(event) => setModelKey(event.target.value)}>
              {!availableKeys.length ? <option value="">{providers === null ? error ? '无法读取模型' : '正在读取模型…' : '请先添加模型'}</option> : null}
              {providers?.map((provider) => <optgroup label={provider.displayName} key={provider.id}>
                {provider.models.map((model) => <option key={model} value={modelSelectionKey(provider.id, model)}>{provider.displayName} · {model}</option>)}
              </optgroup>)}
            </select>
          </label>
          <div className="model-settings-help">
            <p>{providers?.length === 0 ? `还没有可用的${label}模型，请先在 API Key 中添加。` : `${label}模型来自 API Key 中已添加的提供方。`}</p>
            <button type="button" className="modal-button" onClick={props.onConfigureApiKeys}>配置 API Key</button>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-button ghost" onClick={props.onClose}>取消</button>
          <button type="button" className="modal-button primary" onClick={save}
            disabled={providers === null || (props.kind === 'summary' && !selectedModelKey)}>保存设置</button>
        </div>
      </div>
    </div>
  );
}
