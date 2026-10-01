export type ModelApiStyle = 'openai-compat' | 'anthropic' | 'gemini';
export type ModelSelection = { providerId: string; model: string };
export type ModelProvider = {
  id: string;
  kind: 'builtin' | 'custom';
  displayName: string;
  apiStyle: ModelApiStyle;
  baseUrl: string;
  models: string[];
  keyConfigured: boolean;
  keyNeedsReentry: boolean;
};
export type ModelProviderPreset = Omit<ModelProvider, 'kind' | 'keyConfigured' | 'keyNeedsReentry'>;
export type SaveModelProviderInput = Omit<ModelProvider, 'keyConfigured' | 'keyNeedsReentry'> & {
  editingId?: string;
  apiKey?: string;
};
export type DiscoverProviderModelsInput = {
  providerId?: string;
  apiStyle: ModelApiStyle;
  baseUrl: string;
  apiKey?: string;
};
export type ModelProviderResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Initial suggestions follow atlasnote-pro's catalog; online discovery reflects account availability.
// DeepSeek IDs: https://api-docs.deepseek.com/api/list-models/
export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  { id: 'deepseek', displayName: 'DeepSeek', apiStyle: 'openai-compat',
    baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-flash', 'deepseek-v4-pro'] },
  { id: 'openai', displayName: 'OpenAI', apiStyle: 'openai-compat',
    baseUrl: 'https://api.openai.com/v1', models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4-mini'] },
  { id: 'anthropic', displayName: 'Anthropic', apiStyle: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1', models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] },
  { id: 'gemini', displayName: 'Google Gemini', apiStyle: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite'] },
];

export class ModelProviderError extends Error {}

export function normalizeModelBaseUrl(value: string): string {
  try {
    if (typeof value !== 'string' || value.length > 2048) throw new Error();
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new ModelProviderError('请输入完整的 HTTP(S) API 地址，不要在地址中填写密钥、查询参数或片段。');
  }
}

export function normalizeModelApiKey(value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 4096 || /[\s\x00-\x1f\x7f]/.test(value.trim())) {
    throw new ModelProviderError('API Key 不能包含空格或换行，且不能超过 4096 个字符。');
  }
  return value.trim() || undefined;
}

export function normalizeModelIds(models: string[]): string[] {
  if (!Array.isArray(models) || models.length === 0 || models.length > 200) {
    throw new ModelProviderError('请添加 1–200 个模型。');
  }
  if (models.some((model) => typeof model !== 'string' || !model.trim() || model.length > 200 || /[\s\x00-\x1f\x7f]/.test(model.trim()))) {
    throw new ModelProviderError('请输入有效的模型 ID，不能包含空格或换行。');
  }
  return [...new Set(models.map((model) => model.trim()))];
}

export function normalizeModelProvider(input: SaveModelProviderInput): SaveModelProviderInput {
  if (!['builtin', 'custom'].includes(input.kind)) throw new ModelProviderError('提供方类型无效。');
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.id)) {
    throw new ModelProviderError('提供方 ID 应以小写字母开头，只使用小写字母、数字和短横线，最多 64 个字符。');
  }
  if (typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 80 || /[\x00-\x1f\x7f]/.test(input.displayName)) {
    throw new ModelProviderError('请输入提供方名称，最多 80 个字符。');
  }
  if (!['openai-compat', 'anthropic', 'gemini'].includes(input.apiStyle)) throw new ModelProviderError('请选择支持的 API 协议。');
  const preset = MODEL_PROVIDER_PRESETS.find((provider) => provider.id === input.id);
  if (input.kind === 'builtin' && (!preset || preset.apiStyle !== input.apiStyle)) throw new ModelProviderError('预设提供方无效。');
  if (input.kind === 'custom' && preset) throw new ModelProviderError('这个 ID 已用于预设提供方，请换一个。');
  return {
    id: input.id, kind: input.kind, displayName: preset?.displayName ?? input.displayName.trim(),
    apiStyle: input.apiStyle, baseUrl: normalizeModelBaseUrl(input.baseUrl), models: normalizeModelIds(input.models),
    ...(input.editingId === undefined ? {} : { editingId: input.editingId }),
    apiKey: normalizeModelApiKey(input.apiKey),
  };
}
