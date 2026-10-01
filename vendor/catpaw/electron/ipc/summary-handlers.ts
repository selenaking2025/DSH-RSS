import { ipcMain } from './register';
import { findArticleSummary } from '../data/article-summary-repo';
import { generateArticleSummary } from '../services/generate-article-summary';
import { SummaryError, type ArticleSummaryResult } from '../contracts/article-summary';
import { ModelTextError } from '../services/model-text';
import { ModelProviderError } from '../contracts/model-providers';

const requests = new Map<number, { requestId: string; controller: AbortController }>();
export function stopArticleSummaries() {
  for (const request of requests.values()) request.controller.abort();
  requests.clear();
}

export function registerSummaryHandlers() {
  ipcMain.handle('rss:getArticleSummary', (_event, entryId) => findArticleSummary(entryId));
  ipcMain.handle('rss:cancelArticleSummary', (event, requestId) => {
    const request = requests.get(event.sender.id);
    if (request?.requestId === requestId) request.controller.abort();
  });
  ipcMain.handle('rss:analyzeEntry', async (event, input): Promise<ArticleSummaryResult> => {
    const owner = event.sender.id;
    requests.get(owner)?.controller.abort();
    const request = { requestId: input.requestId, controller: new AbortController() };
    requests.set(owner, request);
    const cancel = () => request.controller.abort();
    event.sender.once('destroyed', cancel);
    try {
      const analysis = await generateArticleSummary(input, request.controller.signal);
      request.controller.signal.throwIfAborted();
      return { ok: true, analysis };
    } catch (error) {
      if (request.controller.signal.aborted) return { ok: false, code: 'CANCELLED', error: '摘要生成已取消。' };
      return { ok: false, code: error instanceof SummaryError ? error.code : 'FAILED',
        error: error instanceof SummaryError || error instanceof ModelTextError || error instanceof ModelProviderError
          ? error.message : '生成摘要失败，请稍后重试。已有摘要已保留。' };
    } finally {
      event.sender.removeListener('destroyed', cancel);
      if (requests.get(owner) === request) requests.delete(owner);
    }
  });
}
