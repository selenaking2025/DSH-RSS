import { AsyncLocalStorage } from 'node:async_hooks';
const lifetime = new AsyncLocalStorage<AbortSignal>();
export const requestSignal = () => lifetime.getStore();
export function withRequestSignal<T>(signal: AbortSignal, operation: () => T): T { return lifetime.run(signal, operation); }
