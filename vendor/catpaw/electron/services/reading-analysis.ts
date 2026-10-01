import type { DecisionTarget, DecisionQuestion } from '../contracts/decision';
import { DecisionError, decisionCacheKey } from '../contracts/decision';
import type { ReadingFocus, ReadingWindow } from '../contracts/smart-reading';
import { estimateReadingMinutes } from '../contracts/reading-budget';
import { readerJobManager } from '../reader-job-manager';
import { getPlaywrightProfileDir } from '../runtime';
import { getEntry } from '../data/entry-repo';
import { articleSummarySourceHash } from '../data/article-summary-repo';
import { reserveReadingTokens, saveReadingScore, settleReadingTokens, sourceStillCurrent, type ReadingCandidate } from '../data/reading-entry-repo';
import { requestDecision } from '../providers/jev';
import { assessReadingSource } from '../providers/reading-decisions';
import { decisionSettings } from './decision-settings';
import { runWithStorageWriteRetry } from './sqlite-retry';
import { planReadingComparisons, runReadingComparisons } from './reading-comparisons';

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export function readingDay() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
export function createReadingCaller(target: DecisionTarget, revision: number, signal: AbortSignal) {
  return async (state: unknown, questions: Record<string, DecisionQuestion>) => {
    signal.throwIfAborted();
    const day = readingDay(), reserved = Buffer.byteLength(JSON.stringify({ model: target.model, state, questions }));
    const result = await requestDecision(target, state, questions, signal, async () => {
      const settings = decisionSettings.get();
      if (!settings.enabled || settings.revision !== revision) throw new DecisionError('智能阅读设置已更改，请重新开始。');
      // Reserve each network attempt, including retries. Unknown outcomes retain their reservation.
      if (!await runWithStorageWriteRetry('readingUsage', () => {
        signal.throwIfAborted(); return reserveReadingTokens(day, reserved, settings.dailyTokenLimit);
      })) throw new DecisionError('已达到今天的智能阅读用量上限，可在设置中调整。', 'LIMIT');
    });
    await runWithStorageWriteRetry('readingUsage', () => { signal.throwIfAborted(); settleReadingTokens(day, reserved, result.inputTokens); });
    return result;
  };
}
export async function analyzeReadingCandidate(candidate: ReadingCandidate, focus: ReadingFocus, window: ReadingWindow,
  target: DecisionTarget, revision: number, signal: AbortSignal) {
  const settings = decisionSettings.get(), call = createReadingCaller(target, revision, signal), model = decisionCacheKey(target);
  const eligible = (assessment: NonNullable<ReadingCandidate['assessment']>) => !assessment.insufficient && assessment.relevance >= 0.5 && assessment.confidence >= 0.6 && assessment.excluded < 0.8;
  if (candidate.assessment) {
    if (!eligible(candidate.assessment)) return;
    const plan = planReadingComparisons(candidate, focus, window, model, candidate.assessment, candidate.sourceHash!);
    if (!plan.eventsChanged && !plan.historyChanged) return;
  }
  let prepared = await abortable(readerJobManager.enqueue({ kind: 'prepare_article_summary', entryId: candidate.id, priority: 'background' }), signal);
  if (settings.autoFetch && (!prepared.ok || prepared.source.sourceKind === 'excerpt') && candidate.contentFetchStatus !== 'fetched' && candidate.link) {
    await abortable(readerJobManager.enqueue({ kind: 'fetch_entry_content', entryId: candidate.id, userDataDir: getPlaywrightProfileDir(), priority: 'background' }), signal).catch(() => {});
    signal.throwIfAborted();
    prepared = await abortable(readerJobManager.enqueue({ kind: 'prepare_article_summary', entryId: candidate.id, priority: 'background' }), signal);
  }
  signal.throwIfAborted();
  if (!prepared.ok) {
    const entry = getEntry(candidate.id); if (!entry) return;
    await runWithStorageWriteRetry('readingScore', () => { signal.throwIfAborted(); return saveReadingScore({ entryId: candidate.id, focus,
      sourceHash: articleSummarySourceHash(entry), feedRevision: candidate.feedRevision, model,
      assessment: { relevance: 0, specificity: 0, applicability: 0, confidence: 0, excluded: 0, evidence: [], sourceKind: 'excerpt',
        model: target.model, insufficient: true, minutes: null } }); });
    return;
  }
  const source = prepared.source;
  if (!sourceStillCurrent(candidate.id, source.sourceHash, candidate.feedRevision)) return;
  const assessment = candidate.assessment && candidate.sourceHash === source.sourceHash
    ? candidate.assessment : await assessReadingSource(source, focus, call);
  assessment.minutes = estimateReadingMinutes(source.text, candidate.mediaType, candidate.mediaUrl);
  const saved = candidate.assessment && candidate.sourceHash === source.sourceHash || await runWithStorageWriteRetry('readingScore', () => {
    signal.throwIfAborted();
    if (decisionSettings.get().revision !== revision) return false;
    return saveReadingScore({ entryId: candidate.id, sourceHash: source.sourceHash, feedRevision: candidate.feedRevision, focus, model, assessment });
  });
  if (!saved || !eligible(assessment)) return;
  const plan = planReadingComparisons(candidate, focus, window, model, assessment, source.sourceHash);
  if (plan.eventsChanged || plan.historyChanged) await runReadingComparisons(candidate, source, target, revision, plan, call, signal);
}
