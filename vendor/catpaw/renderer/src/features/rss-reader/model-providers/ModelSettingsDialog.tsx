import { useEffect, useState, type ReactNode } from 'react';
import type { ModelProvider } from '../../../../../electron/contracts/model-providers';
import { modelSelectionKey } from './model-selection';
import { isDailyModelTokenLimit, type ModelUsageStatus } from '../../../../../electron/contracts/model-usage';
import { ModelUsageSettings } from './ModelUsageSettings';
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
  const [usage, setUsage] = useState<ModelUsageStatus | null>(null);
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [dailyLimit, setDailyLimit] = useState('100000');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    if (typeof window.catpaw?.rss.listModelProviders !== 'function' || typeof window.catpaw?.rss.getModelUsage !== 'function') {
      setError('配置功能已更新，请重启 Catpaw 后使用。');
      return;
    }
    void Promise.all([window.catpaw.rss.listModelProviders(), window.catpaw.rss.getModelUsage()]).then(([result, daily]) => {
      if (!active) return;
      if (result.ok) setProviders(result.data.filter((provider) => provider.models.length));
      else setError(result.error);
      if (daily.ok) {
        setUsage(daily.data);
        setBudgetEnabled(daily.data.dailyTokenLimit !== null);
        setDailyLimit(String(daily.data.dailyTokenLimit ?? 100000));
      } else setError(daily.error);
    }).catch(() => { if (active) setError(`无法读取${label}模型，请重试。`); });
    return () => { active = false; };
  }, [reload, label]);

  useEffect(() => {
    const rss = window.catpaw?.rss;
    if (!usage || !rss) return;
    let active = true;
    const timer = window.setInterval(() => {
      void rss.getModelUsage().then((result) => {
        if (active && result.ok) setUsage(result.data);
      }).catch(() => {});
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [usage !== null]);

  const availableKeys = providers?.flatMap((provider) => provider.models.map((model) => modelSelectionKey(provider.id, model))) ?? [];
  const selectedModelKey = availableKeys.includes(modelKey) ? modelKey : availableKeys[0] ?? '';
  async function save() {
    const rss = window.catpaw?.rss;
    if (!rss || !usage || saving) return;
    const limit = budgetEnabled ? Number(dailyLimit) : null;
    if (!isDailyModelTokenLimit(limit)) { setError('每日上限须为 1–1,000,000,000 的整数。'); return; }
    setSaving(true); setError(null);
    try {
      if (limit !== usage?.dailyTokenLimit) {
        const result = await rss.setModelDailyTokenLimit(limit);
        if (!result.ok) { setError(result.error); return; }
        setUsage(result.data);
      }
      props.onSave(selectedModelKey || modelKey);
      props.onClose();
    } catch { setError(`保存${label}设置失败，请重试。`); }
    finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={`modal-card model-settings-modal ${props.kind}-settings-modal`}>
        <div className="modal-body">
          <div className="model-settings-heading">
            <h2 id={titleId}>{label}设置</h2>
            <p>{props.description}</p>
          </div>
          {error ? <div className="reader-error" role="alert">{error}{providers === null || usage === null ? <button type="button" className="modal-button" onClick={() => setReload((value) => value + 1)}>重新加载</button> : null}</div> : null}
          {props.children}
          <label className="modal-row">
            <span>{label}模型</span>
            <select aria-label={`${label}模型`} value={selectedModelKey} disabled={!availableKeys.length || saving} onChange={(event) => setModelKey(event.target.value)}>
              {!availableKeys.length ? <option value="">{providers === null ? error ? '无法读取模型' : '正在读取模型…' : '请先添加模型'}</option> : null}
              {providers?.map((provider) => <optgroup label={provider.displayName} key={provider.id}>
                {provider.models.map((model) => <option key={model} value={modelSelectionKey(provider.id, model)}>{provider.displayName} · {model}</option>)}
              </optgroup>)}
            </select>
          </label>
          <div className="model-settings-help">
            <p>{providers?.length === 0 ? `还没有可用的${label}模型，请先在 API Key 中添加。` : `${label}模型来自 API Key 中已添加的提供方。`}</p>
            <button type="button" className="modal-button" onClick={props.onConfigureApiKeys} disabled={saving}>配置 API Key</button>
          </div>
          {usage ? <ModelUsageSettings usage={usage} enabled={budgetEnabled} limit={dailyLimit} disabled={saving}
            onEnabledChange={setBudgetEnabled} onLimitChange={setDailyLimit} /> : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="modal-button ghost" onClick={props.onClose} disabled={saving}>取消</button>
          <button type="button" className="modal-button primary" onClick={() => void save()}
            disabled={saving || providers === null || usage === null || (props.kind === 'summary' && !selectedModelKey)}>保存设置</button>
        </div>
      </div>
    </div>
  );
}
