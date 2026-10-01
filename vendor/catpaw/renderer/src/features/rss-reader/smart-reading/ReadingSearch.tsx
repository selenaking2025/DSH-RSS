import { useRef, useState } from 'react';
import type { ReadingQuery } from '../../../../../electron/contracts/smart-reading';
import { localDate } from './ReadingFocusEditor';
import { unwrapReading } from './useSmartReading';

export function ReadingSearch({ disabled, onSearch }: { disabled: boolean; onSearch: (query: ReadingQuery) => Promise<void> }) {
  const [text, setText] = useState(''), [query, setQuery] = useState<ReadingQuery | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  async function parse() {
    const request = ++sequence.current; setBusy(true); setError('');
    try { const next = unwrapReading(await window.catpaw!.rss.parseReadingQuery(text)); if (request === sequence.current) setQuery(next); }
    catch (reason) { if (request === sequence.current) setError(reason instanceof Error ? reason.message : '无法解析筛选条件。'); }
    finally { if (request === sequence.current) setBusy(false); }
  }
  return <form className="reading-query" onSubmit={(event) => { event.preventDefault(); void parse(); }}>
    <div className="reading-query-input"><input type="search" aria-label="自然语言筛选" placeholder="最近一周，有实验数据的 Agent 文章"
      value={text} maxLength={2000} onChange={(event) => { setText(event.target.value); setQuery(null); sequence.current++; setBusy(false); }} />
      <button className="modal-button" disabled={!text.trim() || busy}>解析条件</button></div>
    {error ? <p className="reader-error" role="alert">{error}</p> : null}
    {query ? <div className="reading-query-review">
      <label>从<input aria-label="筛选开始日期" type="date" value={localDate(query.since)} onChange={(event) => { if (event.target.value) setQuery({ ...query, since: new Date(`${event.target.value}T00:00:00`).getTime() }); }} /></label>
      <label>到<input aria-label="筛选结束日期" type="date" value={localDate(query.until - 1)} onChange={(event) => { if (event.target.value) { const date = new Date(`${event.target.value}T00:00:00`); date.setDate(date.getDate() + 1); setQuery({ ...query, until: date.getTime() }); } }} /></label>
      <label className="reading-check"><input type="checkbox" checked={query.onlyUnread} onChange={(event) => setQuery({ ...query, onlyUnread: event.target.checked })} />只看未读</label>
      <p className="reading-help">{query.feedIds.length + query.groupIds.length ? '已匹配指定的订阅来源' : '在全部订阅中查找'} · 按这句话判断内容是否符合条件。</p>
      <button type="button" className="modal-button primary" disabled={disabled || busy || query.until <= query.since} onClick={() => { setBusy(true); void onSearch(query).finally(() => setBusy(false)); }}>开始语义筛选</button>
    </div> : null}
  </form>;
}
