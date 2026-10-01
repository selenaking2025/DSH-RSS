import { useCallback, useState } from 'react';
import type { TranslationLanguagePreference } from './document';

const PREFERENCES_KEY = 'catpaw.translation.preferences';
export type TranslationPreferences = { language: TranslationLanguagePreference; modelKey: string };

function readPreferences(): TranslationPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}');
    return { language: ['auto', 'zh-CN', 'en'].includes(value.language) ? value.language : 'auto', modelKey: typeof value.modelKey === 'string' ? value.modelKey : '' };
  } catch { return { language: 'auto', modelKey: '' }; }
}

export function useTranslationPreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  const savePreferences = useCallback((value: TranslationPreferences) => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
    setPreferences((previous) => previous.language === value.language && previous.modelKey === value.modelKey ? previous : value);
  }, []);
  return { preferences, savePreferences };
}
