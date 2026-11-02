import type { ModelApiStyle } from '../contracts/model-providers';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const tokens = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Includes cached input and reasoning tokens, not just visible output. */
export function reportedModelTokens(payload: unknown, style: ModelApiStyle): number | null {
  if (!record(payload)) return null;
  const usage = style === 'gemini' ? payload.usageMetadata : payload.usage;
  if (!record(usage)) return null;
  let parts: unknown[];
  let reported: unknown;
  if (style === 'anthropic') {
    parts = [usage.input_tokens, usage.output_tokens, usage.cache_creation_input_tokens ?? 0, usage.cache_read_input_tokens ?? 0];
  } else if (style === 'gemini') {
    parts = [usage.promptTokenCount, usage.candidatesTokenCount ?? 0, usage.thoughtsTokenCount ?? 0, usage.toolUsePromptTokenCount ?? 0];
    reported = usage.totalTokenCount;
  } else {
    parts = [usage.prompt_tokens, usage.completion_tokens];
    reported = usage.total_tokens;
  }
  if (!parts.every(tokens) || (reported !== undefined && !tokens(reported))) return null;
  const total = parts.reduce<number>((sum, part) => sum + (part as number), 0);
  // A malformed/underreported total must never release reserved allowance.
  if (!tokens(total) || (reported !== undefined && (reported as number) < total)) return null;
  const result = reported === undefined ? total : reported as number;
  return result > 0 ? result : null;
}
