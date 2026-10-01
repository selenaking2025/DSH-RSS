import { getEntry } from '../data/entry-repo';
import { findArticleTranslation, saveArticleTranslation } from '../data/article-translation-repo';
import { modelProviderStore } from './model-provider-store';
import { translateArticleTexts } from './article-translation';
import { runWithStorageWriteRetry } from './sqlite-retry';
import { ModelProviderError } from '../contracts/model-providers';
import { TranslationError, type TranslateArticleInput, type TranslateArticleResult } from '../contracts/translation';

export async function generateArticleTranslation(input: TranslateArticleInput, signal: AbortSignal,
  onProgress: (completed: number, total: number) => void): Promise<TranslateArticleResult> {
  try {
    signal.throwIfAborted();
    if (!getEntry(input.entryId)) throw new TranslationError('文章已不存在，请重新选择文章。');
    const saved = findArticleTranslation(input);
    if (saved) return { ok: true, texts: saved };
    const providers = modelProviderStore.list();
    const provider = input.selection ? providers.find((provider) => provider.id === input.selection!.providerId) : providers[0];
    const model = input.selection?.model ?? provider?.models[0];
    if (!provider || !model || !provider.models.includes(model)) {
      return { ok: false, code: 'CONFIG_REQUIRED', error: '请先在 API Key 设置中添加模型，再翻译这篇文章。' };
    }
    const apiKey = await modelProviderStore.discoveryKey({ providerId: provider.id, baseUrl: provider.baseUrl, apiStyle: provider.apiStyle });
    const texts = await translateArticleTexts({ ...provider, model, apiKey }, input.texts, input.targetLanguage, signal, onProgress);
    try {
      await runWithStorageWriteRetry('saveArticleTranslation', () => {
        signal.throwIfAborted();
        saveArticleTranslation({ ...input, selection: { providerId: provider.id, model } }, texts);
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new TranslationError('译文已生成，但保存到本地失败。请检查磁盘空间后重试。');
    }
    return { ok: true, texts };
  } catch (error) {
    if (signal.aborted) return { ok: false, code: 'CANCELLED', error: '翻译已取消。' };
    return { ok: false, code: 'FAILED', error: error instanceof TranslationError || error instanceof ModelProviderError
      ? error.message : '翻译失败，原稿已保留。请稍后重试。' };
  }
}
