import { createHash } from 'node:crypto';
import { getDb } from './db-core';
import { TranslationError, validateTranslatedTexts, validateTranslationTexts,
  type TranslateArticleInput, type TranslationModelSelection } from '../contracts/translation';

type TranslationLookup = Pick<TranslateArticleInput, 'entryId' | 'targetLanguage' | 'texts' | 'selection'>;

function sourceHash(texts: string[]) {
  validateTranslationTexts(texts);
  // Segment boundaries and order matter when applying a translation to the current document.
  return createHash('sha256').update(JSON.stringify({ version: 1, texts })).digest('hex');
}

export function findArticleTranslation(input: TranslationLookup): string[] | null {
  const values = [input.entryId, sourceHash(input.texts), input.targetLanguage];
  if (input.selection) values.push(input.selection.providerId, input.selection.model);
  const row = getDb().prepare(`
    SELECT translated_texts FROM article_translations
    WHERE entry_id = ? AND source_hash = ? AND target_language = ?
      ${input.selection ? 'AND provider_id = ? AND model = ?' : ''}
    ORDER BY saved_at DESC, provider_id, model LIMIT 1
  `).get(...values) as { translated_texts: string } | undefined;
  if (!row) return null;
  try {
    const texts: unknown = JSON.parse(row.translated_texts);
    validateTranslatedTexts(input.texts, texts);
    return texts;
  } catch {
    throw new TranslationError('已保存的译文不完整，无法读取。请从完整备份恢复后重试。');
  }
}

export function saveArticleTranslation(input: TranslationLookup & { selection: TranslationModelSelection }, texts: string[]) {
  const hash = sourceHash(input.texts);
  validateTranslatedTexts(input.texts, texts);
  getDb().prepare(`
    INSERT INTO article_translations (entry_id, source_hash, target_language, provider_id, model, translated_texts, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (entry_id, source_hash, target_language, provider_id, model)
    DO UPDATE SET translated_texts = excluded.translated_texts, saved_at = excluded.saved_at
  `).run(input.entryId, hash, input.targetLanguage, input.selection.providerId, input.selection.model, JSON.stringify(texts), Date.now());
}
