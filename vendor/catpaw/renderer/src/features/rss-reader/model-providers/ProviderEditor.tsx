import { useState, type FormEvent } from 'react';
import { normalizeModelBaseUrl, normalizeModelIds, normalizeModelProvider,
  type ModelApiStyle, type ModelProvider, type ModelProviderPreset } from '../../../../../electron/contracts/model-providers';
import { ProviderModelCatalog } from './ProviderModelCatalog';

type Props = {
  provider?: ModelProvider;
  preset?: ModelProviderPreset;
  onBusy(value: boolean): void;
  onSaved(providers: ModelProvider[], name: string): void;
  onCancel(): void;
};

export function ProviderEditor({ provider, preset, onBusy, onSaved, onCancel }: Props) {
  const initial = provider ?? preset;
  const custom = !preset;
  const [id, setId] = useState(initial?.id ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [apiStyle, setApiStyle] = useState<ModelApiStyle>(initial?.apiStyle ?? 'openai-compat');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState(initial?.models ?? []);
  const [modelDraft, setModelDraft] = useState('');
  const [catalog, setCatalog] = useState<string[] | null>(null);
  const [operation, setOperation] = useState<'save' | 'discover' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = operation !== null;
  const keyHint = provider?.keyNeedsReentry
    ? '旧版密钥需要重新保存。请粘贴 API Key，保存和使用均无需系统密码。'
    : provider?.keyConfigured
      ? '密钥已保存在 Catpaw 本地，留空即可继续使用。修改地址或协议时，请重新输入密钥。'
      : '密钥保存在 Catpaw 本地配置中，保存和使用均无需系统密码。';

  function begin(value: 'save' | 'discover') { setOperation(value); onBusy(true); setError(null); }
  function finish() { setOperation(null); onBusy(false); }
  function changeModels(value: string[]) { setModels(value); setError(null); }
  function addModel() {
    if (!modelDraft.trim()) return;
    try { changeModels(normalizeModelIds([...models, modelDraft])); setModelDraft(''); }
    catch (error) { setError((error as Error).message); }
  }

  async function discover() {
    if (busy) return;
    try { normalizeModelBaseUrl(baseUrl); }
    catch (error) { setError((error as Error).message); return; }
    if (!custom && !apiKey.trim() && !provider?.keyConfigured) { setError('请先填写 API Key。'); return; }
    begin('discover');
    try {
      const result = await window.catpaw!.rss.discoverProviderModels({
        ...(provider ? { providerId: provider.id } : {}), apiStyle, baseUrl, apiKey,
      });
      if (result.ok) setCatalog(result.data);
      else setError(result.error);
    } catch { setError('读取模型列表失败，请稍后重试。'); }
    finally { finish(); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    let input;
    try {
      input = normalizeModelProvider({
        id: id.trim(), kind: custom ? 'custom' : 'builtin', displayName, apiStyle, baseUrl, apiKey,
        models: modelDraft.trim() ? [...models, modelDraft] : models,
        ...(provider ? { editingId: provider.id } : {}),
      });
    } catch (error) { setError((error as Error).message); return; }
    begin('save');
    try {
      const result = await window.catpaw!.rss.saveModelProvider(input);
      if (result.ok) { setApiKey(''); onSaved(result.data, input.displayName); }
      else setError(result.error);
    } catch { setError('保存提供方失败，请稍后重试。'); }
    finally { finish(); }
  }

  return (
    <form className="provider-editor" aria-label={provider ? `编辑 ${provider.displayName}` : custom ? '添加自定义提供方' : `添加 ${displayName}`} onSubmit={save}>
      <h3>{provider ? `编辑 ${provider.displayName}` : custom ? '自定义提供方' : displayName}</h3>
      {custom ? (
        <div className="provider-fields-grid">
          <label className="provider-field">显示名称
            <input aria-label="显示名称" autoFocus autoComplete="off" maxLength={80} placeholder="如 cliproxy" value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label className="provider-field">提供方 ID
            <input aria-label="提供方 ID" autoComplete="off" maxLength={64} placeholder="如 cliproxy" value={id} disabled={busy || Boolean(provider)} onChange={(event) => setId(event.target.value)} />
            <span className="provider-hint">小写字母、数字或短横线，创建后不可修改。</span>
          </label>
        </div>
      ) : null}
      <label className="provider-field">API Key
        <input aria-label="API Key" autoFocus={!custom} type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={apiKey} disabled={busy}
          placeholder={provider?.keyNeedsReentry ? '请重新粘贴 API Key' : provider?.keyConfigured ? '留空则保留已保存的密钥' : custom ? '输入 API Key；无需认证的服务可留空' : '输入 API Key'}
          onChange={(event) => { setApiKey(event.target.value); setError(null); }} />
        <span className="provider-hint">{keyHint}</span>
      </label>
      <div className={custom ? 'provider-fields-grid provider-endpoint-fields' : undefined}>
        <label className="provider-field">API 地址
          <input aria-label="API 地址" type="url" maxLength={2048} placeholder="https://api.example.com/v1" value={baseUrl} disabled={busy}
            onChange={(event) => { setBaseUrl(event.target.value); setCatalog(null); setError(null); }} />
          <span className="provider-hint">填写 API 根地址，保留 /v1 等路径。</span>
        </label>
        {custom ? (
          <label className="provider-field">API 协议
            <select aria-label="API 协议" value={apiStyle} disabled={busy} onChange={(event) => { setApiStyle(event.target.value as ModelApiStyle); setCatalog(null); setError(null); }}>
              <option value="openai-compat">OpenAI 兼容</option>
              <option value="anthropic">Anthropic Messages</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </label>
        ) : null}
      </div>
      <ProviderModelCatalog models={models} draft={modelDraft} catalog={catalog} busy={busy} discovering={operation === 'discover'}
        onDraft={setModelDraft} onChange={changeModels} onAdd={addModel} onDiscover={() => void discover()} />
      {error ? <p className="reader-error" role="alert">{error}</p> : null}
      <div className="provider-editor-actions">
        <button type="button" className="modal-button" disabled={busy} onClick={onCancel}>取消</button>
        <button type="submit" className="modal-button primary" disabled={busy}>{operation === 'save' ? '保存中…' : '保存提供方'}</button>
      </div>
    </form>
  );
}
