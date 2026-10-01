import {
  fetchEntryContent,
  getSocialThread,
  resolveXiaoyuzhouAudio,
} from './providers/reader';
import { prepareArticleSummarySource } from './services/article-summary-source';
import type { ReaderWorkerMessage, ReaderWorkerRequest } from './contracts/reader-worker';
import { parseReaderJobResult } from './contracts/reader-jobs';
import { withRequestBudget } from './network/http';

function postMessage(message: ReaderWorkerMessage) {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

async function runRequest(message: ReaderWorkerRequest) {
  switch (message.kind) {
    case 'fetch_entry_content':
      return await fetchEntryContent(message.entryId, message.userDataDir ?? null);
    case 'resolve_xiaoyuzhou_audio':
      return await resolveXiaoyuzhouAudio(message.entryId);
    case 'get_social_thread':
      return getSocialThread(message.entryId);
    case 'prepare_article_summary':
      return prepareArticleSummarySource(message.entryId);
    default:
      throw new Error(`UNSUPPORTED_READER_JOB:${String((message as { kind?: unknown }).kind ?? 'unknown')}`);
  }
}

process.on('message', async (message: ReaderWorkerRequest | undefined) => {
  if (!message || (message as { type?: string }).type?.match(/^(browser|network):/)) return;
  try {
    const payload = parseReaderJobResult(message.kind, await withRequestBudget({ priority: message.priority }, () => runRequest(message)));
    postMessage({
      type: 'result',
      payload: {
        requestId: message.requestId,
        kind: message.kind,
        payload,
      },
    });
  } catch (error) {
    postMessage({
      type: 'result',
      payload: {
        requestId: message.requestId,
        kind: message.kind,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

postMessage({ type: 'ready' });

// A worker is owned by its parent; never keep an orphan writing to the database.
process.once('disconnect', () => process.exit(0));
