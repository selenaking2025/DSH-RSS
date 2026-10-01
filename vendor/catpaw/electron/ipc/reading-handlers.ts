import { ipcMain } from './register';
import { getMainWindow } from '../desktop-window';
import { decisionSettings } from '../services/decision-settings';
import { smartReading } from '../services/smart-reading';
import { getReadingResults } from '../services/reading-results';
import { parseReadingQuery } from '../services/reading-query';
import { readingDay } from '../services/reading-analysis';
import { listReadingFocuses, saveReadingFocus } from '../data/reading-focus-repo';
import { getReadingUsage, invalidateReadingExcerpts } from '../data/reading-entry-repo';
import { recordReadingVisit, saveReadingFeedback, splitReadingEvent } from '../data/reading-history-repo';
import { listFeeds, listGroups } from '../data/feed-repo';
import { runWithStorageWriteRetry } from '../services/sqlite-retry';
import { DecisionError } from '../contracts/decision';
import { ModelProviderError } from '../contracts/model-providers';
import { ReadingError, type ReadingResult } from '../contracts/smart-reading';

async function result<T>(run: () => T | Promise<T>): Promise<ReadingResult<T>> {
  try { return { ok: true, data: await run() }; }
  catch (error) { return { ok: false, error: error instanceof DecisionError || error instanceof ReadingError || error instanceof ModelProviderError
    ? error.message : '智能阅读操作失败，请稍后重试。' }; }
}
export function registerReadingHandlers() {
  smartReading.subscribe((change) => {
    const window = getMainWindow(); if (window && !window.isDestroyed()) window.webContents.send('rss:readingChanged', change);
  });
  ipcMain.handle('rss:getReadingSettings', () => result(() => ({ settings: decisionSettings.get(), usage: getReadingUsage(readingDay()) })));
  ipcMain.handle('rss:saveReadingSettings', (_event, input) => result(async () => {
    await smartReading.cancel(); const previous = decisionSettings.get(), saved = await decisionSettings.save(input);
    if (saved.autoFetch && !previous.autoFetch) await runWithStorageWriteRetry('readingSettings', invalidateReadingExcerpts);
    smartReading.changed('settings'); smartReading.schedule(); return saved;
  }));
  ipcMain.handle('rss:testReadingConnection', (event) => result(async () => {
    const controller = new AbortController(), cancel = () => controller.abort();
    event.sender.once('destroyed', cancel);
    try { return await smartReading.testConnection(controller.signal); }
    finally { event.sender.removeListener('destroyed', cancel); }
  }));
  ipcMain.handle('rss:listReadingFocuses', () => result(() => listReadingFocuses()));
  ipcMain.handle('rss:saveReadingFocus', (_event, input) => result(async () => {
    await smartReading.cancel();
    const saved = await runWithStorageWriteRetry('saveReadingFocus', () => saveReadingFocus(input));
    smartReading.changed('focuses'); smartReading.schedule(); return saved;
  }));
  ipcMain.handle('rss:getReadingStatus', () => smartReading.getStatus());
  ipcMain.handle('rss:startReadingRun', (_event, input) => result(() => smartReading.start(input)));
  ipcMain.handle('rss:cancelReadingRun', () => smartReading.cancel());
  ipcMain.handle('rss:getReadingResults', (_event, input) => result(() => getReadingResults(input)));
  ipcMain.handle('rss:saveReadingFeedback', (_event, input) => result(async () => {
    await runWithStorageWriteRetry('readingFeedback', () => saveReadingFeedback(input.entryId, input.focusId, input.value));
    smartReading.changed('results');
  }));
  ipcMain.handle('rss:recordReadingVisit', (_event, entryId) => result(async () => {
    const settings = decisionSettings.get();
    if (settings.enabled && settings.trackProgress) await runWithStorageWriteRetry('readingVisit', () => recordReadingVisit(entryId));
  }));
  ipcMain.handle('rss:splitReadingEvent', (_event, input) => result(async () => {
    await runWithStorageWriteRetry('splitReadingEvent', () => splitReadingEvent(input.leftId, input.rightId)); smartReading.changed('results');
  }));
  ipcMain.handle('rss:parseReadingQuery', (_event, text) => result(() => parseReadingQuery(text, { feeds: listFeeds(), groups: listGroups() })));
}
