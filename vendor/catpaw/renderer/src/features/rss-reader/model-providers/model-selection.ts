import type { ModelSelection } from '../../../../../electron/contracts/model-providers';

export function modelSelectionKey(providerId: string, model: string) { return JSON.stringify([providerId, model]); }

export function parseModelSelectionKey(key: string): ModelSelection | undefined {
  try {
    const value: unknown = JSON.parse(key);
    if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'string' && part.length > 0)) {
      return { providerId: value[0], model: value[1] };
    }
  } catch { /* No saved preference: use a saved result or the first configured model. */ }
}
