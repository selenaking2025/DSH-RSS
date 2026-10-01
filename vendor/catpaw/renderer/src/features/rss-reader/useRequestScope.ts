import { useCallback, useEffect, useRef } from 'react';

/** Reject results from an old selection, an older request, or an unmounted view. */
export function useRequestScope(key: string | null) {
  const scope = useRef({ key, request: 0 });
  const mounted = useRef(true);
  if (scope.current.key !== key) scope.current = { key, request: 0 };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; scope.current.request += 1; };
  }, []);
  return useCallback(() => {
    const owner = scope.current;
    const request = ++owner.request;
    return () => mounted.current && scope.current === owner && owner.request === request;
  }, []);
}
