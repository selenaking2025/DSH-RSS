import { ipcMain } from './register';
import { generateArticleTranslation } from '../services/generate-article-translation';

const requests = new Map<number, { requestId: string; controller: AbortController }>();
export function stopArticleTranslations() {
  for (const request of requests.values()) request.controller.abort();
  requests.clear();
}

export function registerTranslationHandlers() {
  ipcMain.handle('rss:cancelArticleTranslation', (event, requestId) => {
    const request = requests.get(event.sender.id);
    if (request?.requestId === requestId) request.controller.abort();
  });
  ipcMain.handle('rss:translateArticle', async (event, input) => {
    const owner = event.sender.id;
    requests.get(owner)?.controller.abort();
    const request = { requestId: input.requestId, controller: new AbortController() };
    requests.set(owner, request);
    const cancel = () => request.controller.abort();
    event.sender.once('destroyed', cancel);
    try {
      return await generateArticleTranslation(input, request.controller.signal, (completed, total) => {
        if (!event.sender.isDestroyed() && requests.get(owner) === request) {
          event.sender.send('rss:translationProgress', { requestId: input.requestId, completed, total });
        }
      });
    } finally {
      event.sender.removeListener('destroyed', cancel);
      if (requests.get(owner) === request) requests.delete(owner);
    }
  });
}
