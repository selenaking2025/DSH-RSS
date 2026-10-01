import { useCallback, useEffect, useRef, useState } from 'react';
import type { DecisionSettings } from '../../../../../electron/contracts/decision';
import { todayReadingWindow, type ReadingFocus, type ReadingSnapshot, type ReadingStatus, type ReadingWindow, type ReadingQuery,
  type ReadingFeedback, type ReadingResult } from '../../../../../electron/contracts/smart-reading';
import { useRequestScope } from '../useRequestScope';

export function unwrapReading<T>(result: ReadingResult<T>): T { if (!result.ok) throw new Error(result.error); return result.data; }
export function useSmartReading() {
  const [focuses, setFocuses] = useState<ReadingFocus[]>([]), [focusId, setFocusId] = useState('');
  const [queryFocus, setQueryFocus] = useState<ReadingFocus | null>(null);
  const [settings, setSettings] = useState<DecisionSettings | null>(null);
  const [windowRange, setWindowRange] = useState<ReadingWindow>(() => todayReadingWindow());
  const [snapshot, setSnapshot] = useState<ReadingSnapshot | null>(null), [snapshotKey, setSnapshotKey] = useState('');
  const [status, setStatus] = useState<ReadingStatus | null>(null), [error, setError] = useState<string | null>(null);
  const [hasNew, setHasNew] = useState(false), [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false), startingRef = useRef(false);
  const [budget, setBudget] = useState<number | null>(null), [customBudget, setCustomBudget] = useState(false);
  const alive = useRef(false), configRequest = useRef(0);
  const focus = queryFocus?.id === focusId ? queryFocus : focuses.find((item) => item.id === focusId);
  const scopeKey = `${focusId}:${focus?.revision ?? 0}:${settings?.revision ?? 0}|${windowRange.since}|${windowRange.until}|${windowRange.onlyUnread}`;
  const beginResultRequest = useRequestScope(scopeKey), beginSearchRequest = useRequestScope(scopeKey);
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshotKey === scopeKey ? snapshot : null;
  const failure = useCallback((reason: unknown) => { if (alive.current) setError(reason instanceof Error ? reason.message : '智能阅读操作失败，请重试。'); }, []);
  const reloadConfig = useCallback(async () => {
    const sequence = ++configRequest.current;
    try {
      const [config, interests, state] = await Promise.all([
        window.catpaw!.rss.getReadingSettings(), window.catpaw!.rss.listReadingFocuses(), window.catpaw!.rss.getReadingStatus(),
      ]);
      if (!alive.current || sequence !== configRequest.current) return;
      setSettings(unwrapReading(config).settings);
      const next = unwrapReading(interests); setFocuses(next); setStatus(state);
      setQueryFocus((previous) => next.some((item) => item.id === previous?.id) ? null : previous);
      setFocusId((previous) => previous && !next.find((item) => item.id === previous)?.archived ? previous : next.find((f) => f.enabled && !f.archived)?.id || '');
    } catch (reason) { if (sequence === configRequest.current) failure(reason); }
  }, [failure]);
  const load = useCallback(async () => {
    if (!focusId) return;
    const isCurrent = beginResultRequest(); setLoading(true);
    try {
      const next = unwrapReading(await window.catpaw!.rss.getReadingResults({ focusId, ...windowRange }));
      if (!isCurrent()) return;
      setSnapshot(next); setSnapshotKey(scopeKey); setHasNew(false);
    } catch (reason) { if (isCurrent()) failure(reason); }
    finally { if (isCurrent()) setLoading(false); }
  }, [focusId, scopeKey, windowRange, failure, beginResultRequest]);
  const latestLoad = useRef(load); latestLoad.current = load;
  useEffect(() => {
    alive.current = true; void reloadConfig();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dispose = window.catpaw?.rss.onReadingChanged((change) => {
      if (change.kind === 'status') {
        if (!timer) timer = setTimeout(() => {
          timer = undefined; void window.catpaw!.rss.getReadingStatus().then((next) => { if (alive.current) setStatus(next); }).catch(failure);
        }, 150);
      } else if (change.kind === 'results') {
        if (!snapshotRef.current?.items.length) void latestLoad.current(); else setHasNew(true);
      } else void reloadConfig();
    });
    return () => { alive.current = false; configRequest.current++; dispose?.(); if (timer) clearTimeout(timer); };
  }, [reloadConfig, failure]);
  useEffect(() => { setError(null); setHasNew(false); void load(); }, [load]);
  const start = useCallback(async (id = focusId, range = windowRange) => {
    if (startingRef.current) return;
    startingRef.current = true; setStarting(true); setError(null);
    try { const next = unwrapReading(await window.catpaw!.rss.startReadingRun({ focusId: id, since: range.since, until: range.until, onlyUnread: range.onlyUnread })); if (alive.current) setStatus(next); return next; }
    catch (reason) { failure(reason); }
    finally { startingRef.current = false; if (alive.current) setStarting(false); }
  }, [focusId, windowRange, failure]);
  async function feedback(entryId: string, value: ReadingFeedback | null) {
    const scope = scopeKey;
    try {
      unwrapReading(await window.catpaw!.rss.saveReadingFeedback({ entryId, focusId, value }));
      if (alive.current && currentScope.current === scope) setSnapshot((prev) => prev && ({ ...prev, items: prev.items.map((item) => item.entry.id === entryId ? { ...item, feedback: value } : item) }));
      return alive.current && currentScope.current === scope;
    } catch (reason) { failure(reason); return false; }
  }
  async function search(query: ReadingQuery) {
    setError(null); const isCurrent = beginSearchRequest();
    try {
      const focus = unwrapReading(await window.catpaw!.rss.saveReadingFocus({ title: query.text.slice(0, 80), goal: query.text,
        prefer: '', avoid: '', feedIds: query.feedIds, groupIds: query.groupIds, priority: 2, expiresAt: null,
        enabled: true, archived: false, ephemeral: true }));
      if (!isCurrent()) return;
      setQueryFocus(focus); setFocusId(focus.id); setWindowRange({ since: query.since, until: query.until, onlyUnread: query.onlyUnread });
      return await start(focus.id, query);
    } catch (reason) { if (isCurrent()) failure(reason); }
  }
  function selectFocus(id: string) { setFocusId(id); setQueryFocus(null); setWindowRange(todayReadingWindow()); }
  return { focuses, focusId, focus, settings, budget, setBudget, customBudget, setCustomBudget,
    windowRange, setWindowRange, snapshot: snapshotKey === scopeKey ? snapshot : null, status, error, failure, hasNew, loading, starting,
    start, load, feedback, search, selectFocus, reloadConfig,
    cancel: () => window.catpaw!.rss.cancelReadingRun().catch(failure) };
}

export type SmartReadingState = ReturnType<typeof useSmartReading>;
