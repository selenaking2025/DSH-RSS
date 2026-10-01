import type { DecisionTarget } from '../contracts/decision';
import { decisionCacheKey } from '../contracts/decision';
import type { ReadingAssessment, ReadingFocus, ReadingSource, ReadingWindow } from '../contracts/smart-reading';
import { listReadingCandidates, type ReadingCandidate } from '../data/reading-entry-repo';
import { findReadingProgress, findReadingRelation, listReadingHistory, readingComparisonContext, saveReadingComparisonContext, saveReadingRelation } from '../data/reading-history-repo';
import { compareReadingEvent, compareReadingProgress, type DecisionCaller } from '../providers/reading-decisions';
import { decisionSettings } from './decision-settings';
import { readingSimilarity } from './reading-similarity';
import { runWithStorageWriteRetry } from './sqlite-retry';

export function planReadingComparisons(candidate: ReadingCandidate, focus: ReadingFocus, window: ReadingWindow, model: string, assessment: ReadingAssessment, hash: string) {
  const settings = decisionSettings.get();
  const peers: Array<{ entry: ReadingCandidate; similarity: number }> = [];
  if (settings.groupEvents) {
    let after = '';
    for (;;) {
      const page = listReadingCandidates(focus, window, model, after, 500); if (!page.length) break;
      for (const entry of page) {
        after = entry.id;
        if (entry.id === candidate.id || !entry.assessment || !entry.sourceHash || entry.assessment.relevance < 0.5 || entry.assessment.confidence < 0.6) continue;
        const similarity = readingSimilarity(candidate.title ?? '', entry.title ?? '');
        if (similarity >= 0.12 || (entry.link && entry.link === candidate.link)) peers.push({ entry, similarity });
      }
    }
  }
  peers.sort((a, b) => b.similarity - a.similarity || a.entry.id.localeCompare(b.entry.id));
  const selected = peers.slice(0, 3).map((item) => item.entry);
  const previous = settings.trackProgress ? listReadingHistory(candidate.id)
    .map((entry) => ({ entry, similarity: readingSimilarity(`${candidate.title}\n${assessment.evidence.join('\n')}`, `${entry.title}\n${entry.excerpt}`) }))
    .filter((item) => item.similarity >= 0.12).sort((a, b) => b.similarity - a.similarity || (a.entry.kind === 'known' ? -1 : 1))[0]?.entry : undefined;
  const events = JSON.stringify(selected.map((entry) => [entry.id, entry.sourceHash]));
  const history = JSON.stringify(previous ? [previous.entryId, previous.sourceHash, previous.feedRevision] : null);
  const saved = readingComparisonContext(candidate.id, hash, model);
  return { peers: selected, previous, events, history, eventsChanged: saved?.events !== events, historyChanged: saved?.history !== history };
}

export async function runReadingComparisons(candidate: ReadingCandidate, source: ReadingSource, target: DecisionTarget, revision: number,
  plan: ReturnType<typeof planReadingComparisons>, call: DecisionCaller, signal: AbortSignal) {
  const model = decisionCacheKey(target);
  if (plan.eventsChanged) for (const entry of plan.peers) {
    if (findReadingRelation(candidate.id, entry.id, model)) continue;
    const relation = await compareReadingEvent({ title: source.title, text: source.text.slice(0, 5000) },
      { title: entry.title ?? '', text: entry.assessment!.evidence.join('\n') || entry.estimatedText.slice(0, 5000) }, call);
    await runWithStorageWriteRetry('readingRelation', () => { signal.throwIfAborted();
      return saveReadingRelation(candidate.id, source.sourceHash, entry.id, entry.sourceHash!, model, relation.sameEvent, relation.confidence, false,
        { left: candidate.feedRevision, right: entry.feedRevision }); });
  }
  const progress = plan.historyChanged ? plan.previous ? await compareReadingProgress(source, plan.previous, call) : null
    : findReadingProgress(candidate.id, model);
  await runWithStorageWriteRetry('readingComparison', () => {
    signal.throwIfAborted(); if (decisionSettings.get().revision !== revision) return false;
    return saveReadingComparisonContext(candidate.id, source.sourceHash, model, plan.events, plan.history, progress,
      { feedRevision: candidate.feedRevision, previous: plan.previous });
  });
}
