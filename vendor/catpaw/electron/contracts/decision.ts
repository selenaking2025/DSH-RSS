import { SUMMARY_VERSION } from './article-summary';

export const JEV_BASE_URL = 'https://api.typesafe.ai/v1';
export const JEV_MODEL = 'jev-1.13.0';
export type DecisionQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };
export type DecisionAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; probabilities: Record<string, number> };
export type DecisionResult = { model: string; answers: Record<string, DecisionAnswer>; inputTokens: number; outputTokens: number };
export type DecisionTarget = { baseUrl: string; model: string; apiKey: string };
export type DecisionSettings = {
  baseUrl: string; model: string; enabled: boolean; autoFetch: boolean;
  groupEvents: boolean; trackProgress: boolean; dailyTokenLimit: number;
  revision: number; keyConfigured: boolean;
};
export type SaveDecisionSettings = Omit<DecisionSettings, 'keyConfigured' | 'revision'> & { apiKey?: string; clearKey?: boolean };
export function decisionCacheKey(target: Pick<DecisionTarget, 'baseUrl' | 'model'>) { return JSON.stringify([target.baseUrl, target.model, SUMMARY_VERSION]); }
export class DecisionError extends Error {
  constructor(message: string, readonly code: 'CONFIG_REQUIRED' | 'FAILED' | 'LIMIT' = 'FAILED') { super(message); }
}
