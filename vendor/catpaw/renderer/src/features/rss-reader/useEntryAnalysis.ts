import { useCallback, useEffect, useRef, useState } from 'react';
import type { Entry, EntryAnalysis } from './types';
import { useRequestScope } from './useRequestScope';
import { parseModelSelectionKey } from './model-providers/model-selection';

export function useEntryAnalysis(entryId: string | null, entry: Entry | null, reportError: (title: string, error?: unknown) => void, modelKey: string) {
  const beginRequest = useRequestScope(entryId);
  const activeRequest = useRef<string | null>(null);
  const [result, setResult] = useState<{ entryId: string; analysis: EntryAnalysis } | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = useCallback(() => {
    const requestId = activeRequest.current;
    activeRequest.current = null;
    if (requestId) void window.catpaw?.rss.cancelArticleSummary(requestId).catch(() => undefined);
    beginRequest();
    setBusy(false);
  }, [beginRequest]);

  useEffect(() => {
    setResult(null);
    setBusy(false);
    return cancel;
  }, [entryId, cancel]);

  useEffect(() => {
    if (!window.catpaw || !entryId || activeRequest.current) return;
    const current = beginRequest();
    void window.catpaw.rss.getArticleSummary(entryId).then((analysis) => {
      if (current()) setResult(analysis ? { entryId, analysis } : null);
    }).catch((error) => { if (current()) reportError('读取摘要失败', error); });
  }, [entryId, entry?.title, entry?.contentHtml, entry?.contentText, entry?.summary, entry?.contentFetchStatus, busy, beginRequest, reportError]);

  const analyze = useCallback(async () => {
    if (!window.catpaw || !entryId || activeRequest.current) return;
    const current = beginRequest();
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    setBusy(true);
    try {
      const response = await window.catpaw.rss.analyzeEntry({ entryId, requestId,
        regenerate: result?.entryId === entryId, selection: parseModelSelectionKey(modelKey) });
      if (!current()) return;
      if (response.ok) setResult({ entryId, analysis: response.analysis });
      else if (response.code !== 'CANCELLED') reportError('生成摘要失败', response.error);
    } catch (error) {
      if (current()) reportError('生成摘要失败', error);
    } finally {
      if (activeRequest.current === requestId) activeRequest.current = null;
      if (current()) setBusy(false);
    }
  }, [entryId, result, beginRequest, reportError, modelKey]);
  return { entryAnalysis: result?.entryId === entryId ? result.analysis : null, analyzingEntry: busy,
    handleAnalyzeEntry: analyze, handleCancelAnalysis: cancel };
}
