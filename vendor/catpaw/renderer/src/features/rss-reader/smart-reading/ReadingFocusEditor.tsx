import { useState } from 'react';
import { READING_TEMPLATES, type ReadingFocus, type SaveReadingFocus } from '../../../../../electron/contracts/smart-reading';
import type { Feed, FeedGroup } from '../types';
import { unwrapReading } from './useSmartReading';
import { useRequestScope } from '../useRequestScope';

export function focusInput(focus?: ReadingFocus): SaveReadingFocus {
  if (!focus) return { title: '', goal: '', prefer: '', avoid: '', feedIds: [], groupIds: [], priority: 2, expiresAt: null, enabled: true, archived: false, ephemeral: false };
  const { updatedAt: _updatedAt, ...input } = focus; return { ...input, ephemeral: false };
}
export function localDate(timestamp: number) {
  const d = new Date(timestamp); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function ReadingFocusEditor({ focus, feeds, groups, onSaved }: { focus?: ReadingFocus; feeds: Feed[]; groups: FeedGroup[]; onSaved: (focus: ReadingFocus) => void }) {
  const [input, setInput] = useState<SaveReadingFocus>(() => focusInput(focus)), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const beginRequest = useRequestScope(`${focus?.id ?? 'new'}:${focus?.revision ?? 0}`);
  const change = <K extends keyof SaveReadingFocus>(key: K, value: SaveReadingFocus[K]) => setInput((prev) => ({ ...prev, [key]: value }));
  async function save() {
    const isCurrent = beginRequest(); setBusy(true); setError('');
    try { const saved = unwrapReading(await window.catpaw!.rss.saveReadingFocus(input)); if (isCurrent()) onSaved(saved); }
    catch (reason) { if (isCurrent()) setError(reason instanceof Error ? reason.message : '保存失败，请重试。'); }
    finally { if (isCurrent()) setBusy(false); }
  }
  return <form className="reading-settings-fields" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    {!focus ? <div className="reading-templates"><span>从一个例子开始</span>{READING_TEMPLATES.map((template) => <button type="button" className="modal-button" key={template.title}
      onClick={() => setInput({ ...input, ...template })}>{template.title}</button>)}</div> : null}
    {error ? <p className="reader-error" role="alert">{error}</p> : null}
    <label className="modal-row"><span>事项名称</span><input aria-label="事项名称" required maxLength={80} value={input.title} onChange={(event) => change('title', event.target.value)} /></label>
    <label className="modal-row"><span>我正在解决什么问题</span><textarea aria-label="关注目标" required rows={3} maxLength={2000} value={input.goal}
      placeholder="例如：了解小团队如何获得第一批付费用户" onChange={(event) => change('goal', event.target.value)} /></label>
    <label className="modal-row"><span>优先看什么</span><textarea aria-label="优先内容" rows={2} maxLength={1000} value={input.prefer} onChange={(event) => change('prefer', event.target.value)} /></label>
    <label className="modal-row"><span>降低什么内容的优先级</span><textarea aria-label="降低优先级的内容" rows={2} maxLength={1000} value={input.avoid} onChange={(event) => change('avoid', event.target.value)} /></label>
    <div className="reading-field-pair"><label className="modal-row"><span>优先级</span><select aria-label="事项优先级" value={input.priority} onChange={(event) => change('priority', Number(event.target.value))}>
      <option value={3}>优先处理</option><option value={2}>普通</option><option value={1}>空闲时关注</option></select></label>
      <label className="modal-row"><span>关注到哪一天（可选）</span><input type="date" aria-label="事项到期日期" value={input.expiresAt ? localDate(input.expiresAt - 1) : ''}
        onChange={(event) => { const date = event.target.value ? new Date(`${event.target.value}T00:00:00`) : null; date?.setDate(date.getDate() + 1); change('expiresAt', date?.getTime() ?? null); }} /></label></div>
    <details className="reading-sources"><summary>订阅范围 · {input.feedIds.length + input.groupIds.length ? '已指定来源' : '全部订阅'}</summary>
      <p className="reading-help">不勾选时使用全部订阅；文件夹包含子文件夹。</p>
      <div className="reading-sources-list">{groups.map((group) => <label className="reading-check" key={group.id}><input type="checkbox"
        checked={input.groupIds.includes(group.id)} onChange={(event) => change('groupIds', event.target.checked ? [...input.groupIds, group.id] : input.groupIds.filter((id) => id !== group.id))} />文件夹 · {group.name}</label>)}
        {feeds.map((feed) => <label className="reading-check" key={feed.id}><input type="checkbox"
          checked={input.feedIds.includes(feed.id)} onChange={(event) => change('feedIds', event.target.checked ? [...input.feedIds, feed.id] : input.feedIds.filter((id) => id !== feed.id))} />{feed.title || feed.url}</label>)}</div>
    </details>
    <label className="reading-check"><input type="checkbox" checked={input.enabled} onChange={(event) => change('enabled', event.target.checked)} />启用这个事项</label>
    {focus ? <label className="reading-check"><input type="checkbox" checked={input.archived} onChange={(event) => change('archived', event.target.checked)} />归档事项</label> : null}
    <div className="reading-actions"><button type="submit" className="modal-button primary" disabled={busy}>{busy ? '保存中…' : '保存关注事项'}</button></div>
  </form>;
}
