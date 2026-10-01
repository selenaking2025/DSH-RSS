import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranslationLanguage, TranslationProgress } from '../../../../../electron/contracts/translation';
import { defaultTranslationLanguage, prepareTranslationDocument, type TranslationDocument } from './document';
import type { TranslationPreferences } from './useTranslationPreferences';
import { parseModelSelectionKey } from '../model-providers/model-selection';

type Result = { sourceKey: string; language: TranslationLanguage; document: TranslationDocument };

export function useArticleTranslation(source: TranslationDocument, preferences: TranslationPreferences) {
  const sourceKey = JSON.stringify(source);
  const contextKey = JSON.stringify([sourceKey, preferences.language, preferences.modelKey]);
  const activeContext = useRef(contextKey);
  activeContext.current = contextKey;
  const [result, setResult] = useState<Result | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [engagedKey, setEngagedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const requestRef = useRef<{ id: string; contextKey: string } | null>(null);
  const engaged = engagedKey === contextKey;
  const visible = engaged && showTranslation && result?.sourceKey === sourceKey;

  const abort = useCallback(() => {
    const request = requestRef.current;
    requestRef.current = null;
    if (request) void window.catpaw?.rss.cancelArticleTranslation?.(request.id).catch(() => {});
  }, []);
  useEffect(() => {
    setShowTranslation(false); setBusy(false); setError(null); setMessage(null); setProgress(null);
    return abort;
  }, [contextKey, abort]);
  useEffect(() => window.catpaw?.rss.onTranslationProgress?.((next) => {
    if (next.requestId === requestRef.current?.id && requestRef.current.contextKey === activeContext.current) setProgress(next);
  }), []);

  async function toggle() {
    if (!source.entryId) return;
    if (requestRef.current) { abort(); setBusy(false); setMessage('翻译已取消，当前显示原稿。'); return; }
    if (visible) { setShowTranslation(false); setMessage('当前显示原稿，点击文/A可切回译文。'); return; }
    setEngagedKey(contextKey); setError(null); setMessage(null);
    if (typeof window.catpaw?.rss.translateArticle !== 'function') { setError('翻译功能已更新，请重启 Catpaw 后使用。'); return; }
    let prepared: ReturnType<typeof prepareTranslationDocument>;
    try { prepared = prepareTranslationDocument(source); }
    catch (error) { setError((error as Error).message); return; }
    const language = preferences.language === 'auto' ? defaultTranslationLanguage(prepared.texts.join(' ')) : preferences.language;
    const request = { id: crypto.randomUUID(), contextKey };
    requestRef.current = request;
    const current = () => requestRef.current === request && activeContext.current === contextKey;
    setBusy(true); setProgress(null);
    try {
      const response = await window.catpaw.rss.translateArticle({
        requestId: request.id, entryId: source.entryId, selection: parseModelSelectionKey(preferences.modelKey),
        targetLanguage: language, texts: prepared.texts,
      });
      if (!current()) return;
      if (!response.ok) {
        if (response.code === 'CANCELLED') setMessage('翻译已取消，当前显示原稿。');
        else setError(response.error);
        return;
      }
      const translated = { sourceKey, language, document: prepared.apply(response.texts) };
      setResult(translated); setShowTranslation(true);
    } catch { if (current()) setError('翻译失败，原稿已保留。请检查模型设置后重试。'); }
    finally { if (current()) { requestRef.current = null; setBusy(false); } }
  }

  return {
    document: visible ? result.document : null,
    language: visible ? result.language : null,
    busy: engaged && busy, engaged, error: engaged ? error : null, message, progress,
    toggle,
  };
}
