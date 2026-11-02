export const MAX_DAILY_MODEL_TOKENS = 1_000_000_000;
export const MODEL_OUTPUT_TOKEN_LIMIT = 8192;

export type ModelUsageStatus = {
  dailyTokenLimit: number | null;
  day: string;
  usedTokens: number;
  requests: number;
  estimatedRequests: number;
};

export function isDailyModelTokenLimit(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_DAILY_MODEL_TOKENS);
}

export type ConfirmModelRequests = (requests: number) => Promise<boolean>;
export class ModelUsageError extends Error {}
