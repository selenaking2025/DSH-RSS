import { friendlyReaderError } from '../errors';
import { useState } from 'react';
export function useDialogFeedback(notify: (title: string, error?: unknown) => void) {
  const [error, setError] = useState<string | null>(null);
  return {
    error, clearError: () => setError(null),
    reportError: (title: string, detail?: unknown) => {
      const friendly = friendlyReaderError(detail);
      setError(`${title}${friendly ? `：${friendly}` : ''}`);
      notify(title, detail);
    },
  };
}
