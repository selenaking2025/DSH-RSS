/** Private parent/child protocol. The backend never opens a network listener. */
export type BackendRequest = { kind: 'call'; id: string; owner: string; method: string; args: unknown[] };
export type BackendMessage =
  | { kind: 'ready'; methods: string[] }
  | { kind: 'result'; id: string; ok: true; value: unknown }
  | { kind: 'result'; id: string; ok: false; error: string }
  | { kind: 'event'; owner?: string; channel: string; value: unknown }
  | { kind: 'fatal'; error: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCall(value: unknown): BackendRequest {
  if (!isRecord(value) || value.kind !== 'call' || typeof value.id !== 'string' || value.id.length > 128
    || typeof value.owner !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(value.owner)
    || typeof value.method !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]{0,80}$/.test(value.method)
    || !Array.isArray(value.args) || value.args.length > 8 || JSON.stringify(value.args).length > 4 * 1024 * 1024) {
    throw new Error('INVALID_CATPAW_REQUEST');
  }
  return { kind: 'call', id: value.id, owner: value.owner, method: value.method, args: value.args };
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
