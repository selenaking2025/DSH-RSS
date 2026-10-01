import { TRANSLATION_SEGMENT_LIMIT, validateTranslationTexts, type TranslationLanguage } from '../../../../../electron/contracts/translation';

export type TranslationDocument = {
  entryId: string | null;
  title: string;
  html: string | null;
  summary: string | null;
  chapters: string[];
  threads: string[];
};
export type TranslationLanguagePreference = 'auto' | TranslationLanguage;

function splitText(text: string): string[] {
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > TRANSLATION_SEGMENT_LIMIT) {
    let end = TRANSLATION_SEGMENT_LIMIT;
    const boundary = remaining.slice(0, end).match(/[。！？.!?\n]\s*|\s+/g);
    if (boundary?.length) {
      const last = boundary[boundary.length - 1];
      const candidate = remaining.slice(0, end).lastIndexOf(last) + last.length;
      if (candidate > end / 2) end = candidate;
    }
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    parts.push(remaining.slice(0, end)); remaining = remaining.slice(end);
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function defaultTranslationLanguage(text: string): TranslationLanguage {
  const sample = text.slice(0, 20_000);
  if (/[\u3040-\u30ff\uac00-\ud7af]/.test(sample)) return 'zh-CN';
  const chinese = sample.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latin = sample.match(/[a-z]/gi)?.length ?? 0;
  return chinese > 0 && chinese > latin * 0.4 ? 'en' : 'zh-CN';
}

/** Only text is sent to the model. The original DOM owns all tags, URLs and media attributes. */
export function prepareTranslationDocument(source: TranslationDocument) {
  const documentCopy = { ...source, chapters: [...source.chapters], threads: [...source.threads] };
  const texts: string[] = [];
  const writers: Array<(translations: string[]) => void> = [];
  function add(text: string | null, write: (value: string) => void) {
    if (!text || !/\p{L}/u.test(text)) return;
    const parts = splitText(text.trim());
    const offset = texts.length;
    texts.push(...parts);
    const prefix = text.match(/^\s*/)?.[0] ?? '';
    const suffix = text.match(/\s*$/)?.[0] ?? '';
    writers.push((translations) => {
      const value = parts.map((part, index) => {
        const translation = translations[offset + index];
        const leading = part.match(/^\s*/)?.[0] || translation.match(/^\s*/)?.[0] || '';
        const trailing = part.match(/\s*$/)?.[0] || translation.match(/\s*$/)?.[0] || '';
        return leading + translation.trim() + trailing;
      }).join('');
      write((prefix || value.match(/^\s*/)?.[0] || '') + value.trim() + (suffix || value.match(/\s*$/)?.[0] || ''));
    });
  }
  add(source.title, (value) => { documentCopy.title = value; });
  const template = document.createElement('template');
  if (source.html) {
    template.innerHTML = source.html;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const textNode = node;
      if (node.parentElement?.closest('script, style, pre, code, kbd, samp, svg, math, iframe, audio, video, [translate="no"], .notranslate')) continue;
      add(node.textContent, (value) => { textNode.textContent = value; });
    }
  } else add(source.summary, (value) => { documentCopy.summary = value; });
  source.chapters.forEach((text, index) => add(text, (value) => { documentCopy.chapters[index] = value; }));
  source.threads.forEach((text, index) => add(text, (value) => { documentCopy.threads[index] = value; }));
  validateTranslationTexts(texts);
  return {
    texts,
    apply(translations: string[]): TranslationDocument {
      if (translations.length !== texts.length || translations.some((text) => typeof text !== 'string' || !text.trim())) throw new Error('译文段落不完整。');
      writers.forEach((write) => write(translations));
      // textContent escapes model output, so returned HTML cannot introduce markup or scripts.
      return { ...documentCopy, html: source.html ? template.innerHTML : null };
    },
  };
}
