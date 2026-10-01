import { useState } from 'react';
import { ReaderIcon } from '../ReaderIcon';

type Props = {
  models: string[];
  catalog: string[] | null;
  draft: string;
  busy: boolean;
  discovering: boolean;
  onDraft(value: string): void;
  onChange(models: string[]): void;
  onAdd(): void;
  onDiscover(): void;
};

export function ProviderModelCatalog(props: Props) {
  const { models, catalog, draft, busy, discovering, onDraft, onChange, onAdd, onDiscover } = props;
  const [search, setSearch] = useState('');
  const matches = catalog?.filter((model) => model.toLowerCase().includes(search.toLowerCase())) ?? [];
  return (
    <section className="provider-model-catalog" aria-labelledby="provider-models-title">
      <div className="provider-section-heading">
        <h3 id="provider-models-title">模型 <span className="provider-muted">{models.length} / 200</span></h3>
        <button type="button" className="modal-button" disabled={busy} onClick={onDiscover}>
          <ReaderIcon name="refresh" />{discovering ? '正在读取…' : '读取模型列表'}
        </button>
      </div>
      <p className="provider-hint">填写服务提供的模型 ID，或读取列表后勾选。预设模型的可用性以你的账号为准。</p>
      <div className="provider-model-chips" aria-label="已添加的模型">
        {models.map((model) => (
          <span className="provider-model-chip" key={model}>
            <span>{model}</span>
            <button type="button" aria-label={`移除模型 ${model}`} disabled={busy} onClick={() => onChange(models.filter((id) => id !== model))}>
              <ReaderIcon name="close" width={14} height={14} />
            </button>
          </span>
        ))}
      </div>
      <div className="provider-model-add">
        <input aria-label="模型 ID" placeholder="输入模型 ID，如 my-model" value={draft} maxLength={200}
          disabled={busy || models.length >= 200} onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onAdd(); } }} />
        <button className="modal-button" type="button" disabled={busy || !draft.trim() || models.length >= 200} onClick={onAdd}>
          <ReaderIcon name="plus" />添加模型
        </button>
      </div>
      {catalog !== null ? (
        <div className="provider-discovered">
          <p className="provider-hint" role="status">读取到 {catalog.length} 个模型，勾选后添加。</p>
          <input type="search" aria-label="搜索可用模型" placeholder="搜索模型…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="provider-model-options" aria-label="可用模型">
            {matches.slice(0, 100).map((model) => (
              <label key={model}>
                <input type="checkbox" checked={models.includes(model)} disabled={busy || (models.length >= 200 && !models.includes(model))}
                  onChange={(event) => onChange(event.target.checked ? [...models, model] : models.filter((id) => id !== model))} />
                <span>{model}</span>
              </label>
            ))}
            {!matches.length ? <p className="provider-hint">没有匹配的模型。</p> : null}
          </div>
          {matches.length > 100 ? <p className="provider-hint">显示前 100 项，可通过搜索查找其余模型。</p> : null}
        </div>
      ) : null}
    </section>
  );
}
