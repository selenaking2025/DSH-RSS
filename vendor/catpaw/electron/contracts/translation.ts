import type { ModelSelection } from './model-providers';

export type TranslationLanguage = 'zh-CN' | 'en';
export type TranslationModelSelection = ModelSelection;
export type TranslateArticleInput = {
  requestId: string;
  entryId: string;
  selection?: TranslationModelSelection;
  targetLanguage: TranslationLanguage;
  texts: string[];
};
export type TranslationProgress = { requestId: string; completed: number; total: number };
export type TranslateArticleResult = { ok: true; texts: string[] }
  | { ok: false; error: string; code: 'CANCELLED' | 'CONFIG_REQUIRED' | 'FAILED' };
export const TRANSLATION_SEGMENT_LIMIT = 3000;
export const TRANSLATION_TEXT_LIMIT = 120_000;

export class TranslationError extends Error {}

export function validateTranslationTexts(texts: string[]): void {
  if (!Array.isArray(texts) || !texts.length || texts.length > 2000
    || texts.some((text) => typeof text !== 'string' || !text.trim() || text.length > TRANSLATION_SEGMENT_LIMIT)) {
    throw new TranslationError('没有可翻译的正文，或文章段落格式不受支持。');
  }
  if (texts.reduce((length, text) => length + text.length, 0) > TRANSLATION_TEXT_LIMIT) {
    throw new TranslationError('这篇文章超过 12 万字符，暂时无法完整翻译。原稿已保留。');
  }
}

export function validateTranslatedTexts(source: string[], translations: unknown): asserts translations is string[] {
  if (!Array.isArray(translations) || translations.length !== source.length
    || translations.some((text) => typeof text !== 'string' || !text.trim() || text.length > 24_000)) {
    throw new TranslationError('模型未完整翻译所有段落，原稿已保留。请重试或更换模型。');
  }
}
