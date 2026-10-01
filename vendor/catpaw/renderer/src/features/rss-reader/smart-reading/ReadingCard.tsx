import type { ReadingFeedback, ReadingItem } from '../../../../../electron/contracts/smart-reading';
import { formatEntryTimestamp } from '../utils';

const progressLabels = { repeat: '与读过的内容接近', update: '事实有更新', evidence: '新增实测或证据', perspective: '提供不同观点' };
const feedbackLabels = { useful: '有用', irrelevant: '无关', known: '已经知道' };
export function ReadingCard({ item, allItems, source, selected, pinned, onSelect, onFeedback, onSplit, onPin, onSkip, onComplete }: {
  item: ReadingItem; allItems: Map<string, ReadingItem>; source: string; selected: boolean; pinned: boolean;
  onSelect: (id: string) => void; onFeedback: (value: ReadingFeedback | null) => void;
  onSplit: (otherId: string) => void; onPin: () => void; onSkip: () => void; onComplete: () => void;
}) {
  const uncertain = item.assessment.insufficient || item.assessment.confidence < 0.6;
  return <article className={`article-card reading-card ${selected ? 'is-selected' : ''}`} aria-label={item.entry.title ?? '未命名文章'}>
    <div className="reading-card-meta"><span>{source}</span><time>{formatEntryTimestamp(item.entry.publishedAt ?? item.entry.createdAt)}</time>
      <span>{item.minutes === null ? '时长未知' : `${item.assessment.sourceKind === 'excerpt' ? '节选' : ''}约 ${item.minutes} 分钟`}</span></div>
    <button className="reading-card-title" onClick={() => onSelect(item.entry.id)}>{item.entry.title || '未命名文章'}</button>
    <div className="reading-tags"><span>{item.focusTitle}</span>{uncertain ? <span>信息不足 · 待判断</span> : <>
      {item.assessment.specificity >= 0.7 ? <span>有具体依据</span> : null}{item.assessment.applicability >= 0.7 ? <span>可借鉴</span> : null}</>}
      {item.assessment.sourceKind === 'excerpt' ? <span>基于节选</span> : null}</div>
    {item.assessment.evidence.length ? <details className="reading-evidence"><summary>为什么推荐</summary>
      <p className="reading-help">与关注目标匹配的原文片段，供你判断：</p>{item.assessment.evidence.map((text, i) => <blockquote key={i}>{text}</blockquote>)}</details> : null}
    {item.progress ? <details className="reading-evidence reading-progress-evidence"><summary>{progressLabels[item.progress.kind]}</summary>
      <p>与读过的文章相比：<button className="reading-text-button" onClick={() => onSelect(item.progress!.previousEntryId)}>{item.progress.previousTitle}</button></p>
      <p className="reading-help">之前的依据</p><blockquote>{item.progress.previousEvidence}</blockquote><p className="reading-help">这篇文章的依据</p><blockquote>{item.progress.currentEvidence}</blockquote></details> : null}
    {item.relatedIds.length ? <details className="reading-event"><summary>同一事件还有 {item.relatedIds.length} 篇报道</summary><ul>
      {item.relatedIds.map((id) => { const related = allItems.get(id); return related ? <li key={id}>
        <button className="reading-text-button" onClick={() => onSelect(id)}>{related.entry.title || '未命名文章'}</button>
        <button className="reading-text-button muted" aria-label={`分开事件：${related.entry.title}`} onClick={() => onSplit(id)}>不是同一事件</button></li> : null; })}</ul></details> : null}
    <footer className="reading-card-actions"><div className="reading-feedback">{(['useful', 'irrelevant', 'known'] as const).map((value) => <button key={value}
      aria-pressed={item.feedback === value} onClick={() => onFeedback(item.feedback === value ? null : value)}>{feedbackLabels[value]}</button>)}</div>
      <button aria-pressed={pinned} onClick={onPin}>{pinned ? '取消保留' : '优先读'}</button><button onClick={onSkip}>换一篇</button><button onClick={onComplete}>读完</button></footer>
  </article>;
}
