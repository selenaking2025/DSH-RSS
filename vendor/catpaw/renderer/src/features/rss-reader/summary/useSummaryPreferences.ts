import { useCallback, useState } from 'react';

const PREFERENCES_KEY = 'catpaw.summary.preferences';
export type SummaryPreferences = { modelKey: string };

function readPreferences(): SummaryPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}');
    return { modelKey: typeof value.modelKey === 'string' ? value.modelKey : '' };
  } catch { return { modelKey: '' }; }
}

export function useSummaryPreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  const savePreferences = useCallback((value: SummaryPreferences) => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
    setPreferences((previous) => previous.modelKey === value.modelKey ? previous : value);
  }, []);
  return { preferences, savePreferences };
}
