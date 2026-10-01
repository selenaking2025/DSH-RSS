import { getEntry } from '../data/entry-repo';
import { findArticleSummary, saveArticleSummary } from '../data/article-summary-repo';
import { SummaryError, type ArticleSummary, type SummarizeArticleInput } from '../contracts/article-summary';
import { modelProviderStore } from './model-provider-store';
import { summarizeArticleText } from './article-summary';
import { runWithStorageWriteRetry } from './sqlite-retry';
import { readerJobManager } from '../reader-job-manager';
import { getPlaywrightProfileDir } from '../runtime';

export async function generateArticleSummary(input: SummarizeArticleInput, signal: AbortSignal): Promise<ArticleSummary> {
  signal.throwIfAborted();
  if (!input.regenerate) {
    const saved = findArticleSummary(input.entryId);
    if (saved) return saved;
  }
  const entry = getEntry(input.entryId);
  if (!entry) throw new SummaryError('文章已不存在，请重新选择文章。');
  const providers = modelProviderStore.list();
  const selection = input.selection;
  const provider = selection ? providers.find((candidate) => candidate.id === selection.providerId) : providers[0];
  const model = selection?.model ?? provider?.models[0];
  if (!provider || !model || !provider.models.includes(model)) {
    throw new SummaryError(providers.length
      ? '摘要模型已不可用，请在摘要设置中重新选择供应商和模型。'
      : '请先在 API Key 设置中添加模型，再生成摘要。', 'CONFIG_REQUIRED');
  }
  const apiKey = await modelProviderStore.discoveryKey({ providerId: provider.id, baseUrl: provider.baseUrl, apiStyle: provider.apiStyle });
  signal.throwIfAborted();
  let prepared = await readerJobManager.enqueue({ kind: 'prepare_article_summary', entryId: input.entryId });
  signal.throwIfAborted();
  if (entry.link && (!prepared.ok || prepared.source.sourceKind === 'excerpt') && entry.contentFetchStatus !== 'fetched') {
    // The reader owns fetching, deduplication and browser sessions. A failed fetch may still leave a useful excerpt.
    await readerJobManager.enqueue({ kind: 'fetch_entry_content', entryId: input.entryId, userDataDir: getPlaywrightProfileDir() }).catch(() => undefined);
    signal.throwIfAborted();
    prepared = await readerJobManager.enqueue({ kind: 'prepare_article_summary', entryId: input.entryId });
  }
  if (!prepared.ok) throw new SummaryError(prepared.error);
  signal.throwIfAborted();
  const summary = await summarizeArticleText({ ...provider, model, apiKey }, prepared.source, signal);
  const analysis: ArticleSummary = { summary, sourceKind: prepared.source.sourceKind, providerId: provider.id, model, savedAt: Date.now() };
  try {
    await runWithStorageWriteRetry('saveArticleSummary', () => {
      signal.throwIfAborted();
      saveArticleSummary(input.entryId, prepared.source.sourceHash, analysis);
    });
  } catch (error) {
    if (signal.aborted || error instanceof SummaryError) throw error;
    throw new SummaryError('摘要已生成，但保存到本地失败。请检查磁盘空间后重试。');
  }
  return analysis;
}
