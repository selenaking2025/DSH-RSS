import { isRecord } from './protocol.ts';
export const HARNESS_PROVIDER_ID = 'harness';
export const HARNESS_BASE_URL = 'https://catpaw.harness.invalid';
export type ModelRequest = { kind: 'model-request'; id: string; model: string; system: string; content: string };
export type ModelGenerator = (request: Omit<ModelRequest, 'kind' | 'id'>, signal: AbortSignal) => Promise<string>;
export function parseModelRequest(value: unknown): ModelRequest {
  if (!isRecord(value) || value.kind !== 'model-request' || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)
    || typeof value.model !== 'string' || value.model.length > 200 || typeof value.system !== 'string' || value.system.length > 20000
    || typeof value.content !== 'string' || value.content.length > 150000) throw new Error('INVALID_CATPAW_MODEL_REQUEST');
  return value as ModelRequest;
}
