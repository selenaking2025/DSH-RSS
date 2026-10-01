import { decisionSettings } from './decision-settings';
import { getReadingFocus } from '../data/reading-focus-repo';
import { listReadingCandidates } from '../data/reading-entry-repo';
import { findReadingProgress, listReadingRelations } from '../data/reading-history-repo';
import { ReadingError, todayReadingWindow, type ReadingRunInput, type ReadingSnapshot, type ReadingItem } from '../contracts/smart-reading';
import { estimateReadingMinutes, hasReadingPlayback } from '../contracts/reading-budget';
import { decisionCacheKey } from '../contracts/decision';

export function readingWindow(input: ReadingRunInput) {
  const window = { ...todayReadingWindow(), ...input };
  if (!Number.isSafeInteger(window.since) || !Number.isSafeInteger(window.until) || window.until <= window.since
    || window.until - window.since > 367 * 86400000) throw new ReadingError('请选择一年以内的有效日期范围。');
  return window;
}
export function getReadingResults(input: ReadingRunInput & { focusId: string }): ReadingSnapshot {
  const focus = getReadingFocus(input.focusId);
  if (!focus) throw new ReadingError('关注事项已不存在，请重新选择。');
  const settings = decisionSettings.get(), window = readingWindow(input);
  const model = decisionCacheKey(settings);
  const result: ReadingSnapshot = { items: [], total: 0, pending: 0, evaluated: 0, uncertain: 0, version: focus.updatedAt };
  let after = '';
  for (;;) {
    const candidates = listReadingCandidates(focus, window, model, after, 200);
    if (!candidates.length) break;
    for (const candidate of candidates) {
      result.total++; after = candidate.id;
      const assessment = candidate.assessment;
      if (!assessment) { result.pending++; continue; }
      result.evaluated++; result.version = Math.max(result.version, candidate.savedAt);
      if (assessment.insufficient || assessment.confidence < 0.6) result.uncertain++;
      const progress = settings.trackProgress ? findReadingProgress(candidate.id, model) : null;
      const score = Math.round(100 * (assessment.relevance * 0.6 + assessment.specificity * 0.25 + assessment.applicability * 0.15)
        * (1 - assessment.excluded * 0.6)) + (candidate.feedback === 'useful' ? 5 : 0)
        + (progress && progress.kind !== 'repeat' ? 5 : 0) - (progress?.kind === 'repeat' ? 10 : 0);
      const { assessment: _a, sourceHash: _h, savedAt: _s, feedback: _f, feedRevision: _r, estimatedText, ...entry } = candidate;
      result.items.push({ entry, focusId: focus.id, focusTitle: focus.title, score, assessment, feedback: candidate.feedback,
        minutes: hasReadingPlayback(candidate.mediaType, candidate.mediaUrl) ? null
          : assessment.minutes ?? estimateReadingMinutes(estimatedText, candidate.mediaType, candidate.mediaUrl),
        relatedIds: [], progress });
    }
  }
  result.items.sort((a, b) => b.score - a.score || (b.entry.publishedAt ?? b.entry.createdAt) - (a.entry.publishedAt ?? a.entry.createdAt)
    || a.entry.id.localeCompare(b.entry.id));
  if (settings.groupEvents) groupReadingItems(result.items, listReadingRelations(model));
  return result;
}

export function groupReadingItems(items: ReadingItem[], relations: Array<{ leftId: string; rightId: string; sameEvent: number; overridden: number }>) {
  const same = new Map<string, Set<string>>(), split = new Set<string>();
  for (const relation of relations) {
    if (!relation.sameEvent) { if (relation.overridden) split.add([relation.leftId, relation.rightId].sort().join('|')); continue; }
    for (const [a, b] of [[relation.leftId, relation.rightId], [relation.rightId, relation.leftId]]) {
      if (!same.has(a)) same.set(a, new Set()); same.get(a)!.add(b);
    }
  }
  const groups = new Map<string, ReadingItem[]>(), owner = new Map<string, string>();
  for (const item of items) {
    const id = item.entry.id;
    // Compare to the representative, never join clusters through a chain of similarities.
    const representative = [...(same.get(id) ?? [])].find((other) => owner.get(other) === other
      && !groups.get(other)!.some((member) => split.has([member.entry.id, id].sort().join('|'))));
    const groupId = representative ?? id;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId)!.push(item); owner.set(id, groupId);
  }
  for (const group of groups.values()) for (const item of group) item.relatedIds = group.filter((other) => other !== item).map((other) => other.entry.id);
}
