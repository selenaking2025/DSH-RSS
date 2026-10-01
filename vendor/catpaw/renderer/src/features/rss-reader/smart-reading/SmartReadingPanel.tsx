import { useEffect, useMemo, useRef, useState } from 'react';
import { arrangeReadingBudget } from '../../../../../electron/contracts/reading-budget';
import type { ReadingFeedback } from '../../../../../electron/contracts/smart-reading';
import { todayReadingWindow } from '../../../../../electron/contracts/smart-reading';
import type { Feed } from '../types';
import { unwrapReading, type SmartReadingState } from './useSmartReading';
import type { ReadingSettingsTab } from './ReadingSettings';
import { ReadingCard } from './ReadingCard';

export function SmartReadingPanel({ reading, feedById, selectedEntryId, onSelect, onSettings }: {
  reading: SmartReadingState; feedById: Map<string, Feed>; selectedEntryId: string | null;
  onSelect: (id: string) => void; onSettings: (tab: ReadingSettingsTab) => void;
}) {
  const { budget } = reading;
  const [pinned, setPinned] = useState<string[]>([]), [skipped, setSkipped] = useState<string[]>([]);
  const [finished, setFinished] = useState<string[]>([]), [spent, setSpent] = useState(0);
  const completing = useRef(new Set<string>());
  const scope = `${reading.focusId}:${reading.windowRange.since}:${reading.windowRange.until}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const [showUncertain, setShowUncertain] = useState(false), [count, setCount] = useState(30);
  const [undo, setUndo] = useState<{ entryId: string; prior: ReadingFeedback | null } | null>(null);
  useEffect(() => { setPinned([]); setSkipped([]); setFinished([]); setSpent(0); setCount(30); setUndo(null); }, [reading.focusId, reading.windowRange.since, reading.windowRange.until]);
  const running = reading.starting || reading.status?.phase === 'running';
  const today = todayReadingWindow(), isToday = reading.windowRange.since === today.since && reading.windowRange.until === today.until;
  const allItems = useMemo(() => new Map(reading.snapshot?.items.map((item) => [item.entry.id, item]) ?? []), [reading.snapshot]);
  const eligible = useMemo(() => reading.snapshot?.items.filter((item) => !finished.includes(item.entry.id) && item.feedback !== 'irrelevant' && item.feedback !== 'known'
    && (showUncertain ? item.assessment.insufficient || item.assessment.confidence < 0.6
      : !item.assessment.insufficient && item.assessment.confidence >= 0.6 && item.assessment.relevance >= 0.5 && item.assessment.excluded < 0.8)) ?? [], [reading.snapshot, showUncertain, finished]);
  const arranged = useMemo(() => arrangeReadingBudget(eligible, budget === null ? null : Math.max(0, budget - spent), pinned.filter((id) => !finished.includes(id)), skipped), [eligible, budget, pinned, skipped, spent, finished]);
  async function complete(id: string, minutes: number | null) {
    if (completing.current.has(id)) return; completing.current.add(id);
    try { await window.catpaw!.rss.markRead(id, true); if (currentScope.current !== scope) return;
      setFinished((prev) => [...prev, id]); setSpent((prev) => prev + (minutes ?? 0)); }
    catch (error) { reading.failure(error); }
    finally { completing.current.delete(id); }
  }
  async function split(entryId: string, otherId: string) {
    try { unwrapReading(await window.catpaw!.rss.splitReadingEvent({ leftId: entryId, rightId: otherId })); await reading.load(); }
    catch (error) { reading.failure(error); }
  }
  return <section className="reader-articles reading-panel" aria-label="精选文章">
    <div className="reader-articles-header"><div className="reader-articles-heading"><h1 className="reader-articles-title">精选</h1>
      <div className="reader-articles-hint">{reading.focus ? `${isToday ? '今天' : '自选时段'} · ${reading.focus.title}` : 'Jev 为你挑选值得阅读的内容'}</div></div></div>
    <div className="reading-list-status">
      {reading.status ? <p className="reading-run-status" role="status">{running ? `正在判断 ${reading.status.completed} / ${reading.status.total} 篇` : reading.status.message || `已完成 ${reading.status.completed} 篇判断`}</p> : null}
      {reading.error ? <p className="reader-error" role="alert">{reading.error}</p> : null}
      {reading.hasNew ? <button className="reading-new-results" onClick={() => void reading.load()}>新结果已准备好 · 更新清单</button> : null}
      {reading.snapshot ? <div className="reading-results-summary"><span>{arranged.items.length} 篇{budget !== null ? ` · 预计 ${arranged.minutes} 分钟` : ''}</span>
        <span>{reading.snapshot.pending ? `${reading.snapshot.pending} 篇尚未判断` : `已判断 ${reading.snapshot.evaluated} 篇`}</span>
        {reading.snapshot.uncertain ? <button className="reading-text-button" aria-pressed={showUncertain} onClick={() => setShowUncertain(!showUncertain)}>{showUncertain ? '返回精选' : `${reading.snapshot.uncertain} 篇待判断`}</button> : null}</div> : null}
      {arranged.excludedPins.length ? <p className="reading-help">有优先文章超出时间预算或时长未知，请增加预算或选择不限时间。</p> : null}
      {undo ? <p className="reading-notice" role="status">反馈已记录。<button className="reading-text-button" onClick={() => { void reading.feedback(undo.entryId, undo.prior); setUndo(null); }}>撤销反馈</button></p> : null}
      {skipped.length ? <button className="reading-text-button" onClick={() => setSkipped([])}>恢复换掉的文章</button> : null}
      {finished.length ? <p className="reading-help">已完成 {finished.length} 篇{budget === null ? '' : ` · 剩余约 ${Math.max(0, budget - spent)} 分钟`}
        <button className="reading-text-button" onClick={() => { setFinished([]); setSpent(0); setPinned([]); setSkipped([]); }}>重新安排</button></p> : null}
    </div>
    <div className="reading-results-list" aria-busy={reading.loading}>
      {reading.loading && !reading.snapshot ? <p className="reading-empty">正在读取精选…</p> : !arranged.items.length ? <div className="reading-empty">
        <p>{!reading.focusId ? '添加一个关注事项，告诉 Catpaw 你想了解什么。' : running ? '正在为这个事项挑选文章…'
          : !reading.settings?.enabled ? '开启 Jev 智能筛选后，与你关注事项相关的文章会出现在这里。'
          : reading.snapshot?.total === 0 ? reading.windowRange.onlyUnread
            ? '当前范围没有未读文章，可以查看包含已读文章的精选。' : '当前日期和订阅范围内没有文章，请调整筛选范围。'
          : budget !== null && spent >= budget ? '这轮阅读已完成，可以重新安排或到精选设置中增加时间。'
          : reading.snapshot?.pending ? '这个范围还有文章未判断，可在精选设置中开始筛选。' : budget !== null ? '当前时间预算内没有合适的文章，可以增加预算。' : '暂时没有符合条件的文章，可以调整关注目标或查看待判断内容。'}</p>
        {reading.snapshot?.total === 0 && reading.windowRange.onlyUnread ? <button className="modal-button"
          onClick={() => reading.setWindowRange({ ...reading.windowRange, onlyUnread: false })}>查看全部文章</button>
          : <button className="modal-button" onClick={() => onSettings(!reading.focusId ? 'focus' : !reading.settings?.enabled ? 'service' : 'selection')}>{!reading.focusId ? '创建关注事项' : '打开精选设置'}</button>}</div> : arranged.items.slice(0, count).map((item) => <ReadingCard key={item.entry.id}
          item={item} allItems={allItems} source={feedById.get(item.entry.feedId)?.title || '订阅来源'} selected={selectedEntryId === item.entry.id}
          pinned={pinned.includes(item.entry.id)} onSelect={onSelect}
          onFeedback={(value) => { void reading.feedback(item.entry.id, value).then((saved) => { if (saved) setUndo({ entryId: item.entry.id, prior: item.feedback }); }); }}
          onSplit={(otherId) => void split(item.entry.id, otherId)} onPin={() => setPinned((prev) => prev.includes(item.entry.id) ? prev.filter((id) => id !== item.entry.id) : [...prev, item.entry.id])}
          onSkip={() => setSkipped((prev) => [...prev, item.entry.id])} onComplete={() => void complete(item.entry.id, item.minutes)} />)}
      {arranged.items.length > count ? <button className="modal-button reading-load-more" onClick={() => setCount(count + 30)}>查看更多精选</button> : null}
    </div>
  </section>;
}
