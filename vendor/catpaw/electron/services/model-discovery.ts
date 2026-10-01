import { fetchWithTimeout, withRequestBudget } from '../network/http';
import { ModelProviderError, normalizeModelBaseUrl, normalizeModelApiKey,
  type DiscoverProviderModelsInput } from '../contracts/model-providers';

export async function discoverProviderModels(input: DiscoverProviderModelsInput, apiKey?: string): Promise<string[]> {
  const baseUrl = normalizeModelBaseUrl(input.baseUrl);
  if (!['openai-compat', 'anthropic', 'gemini'].includes(input.apiStyle)) throw new ModelProviderError('请选择支持的 API 协议。');
  const url = new URL(`${baseUrl}/models`);
  const key = normalizeModelApiKey(apiKey);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (input.apiStyle === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    url.searchParams.set('limit', '1000');
    if (key) headers['x-api-key'] = key;
  } else if (input.apiStyle === 'gemini') {
    url.searchParams.set('pageSize', '1000');
    if (key) headers['x-goog-api-key'] = key;
  } else if (key) headers.Authorization = `Bearer ${key}`;

  return withRequestBudget({ deadlineAt: Date.now() + 20_000 }, async () => {
    const models = new Set<string>();
    const cursors = new Set<string>();
    for (let page = 0; page < 10; page++) {
      let response: Response;
      try {
        // Do not forward credentials to redirects, including provider-specific key headers.
        response = await fetchWithTimeout(url.href, { headers, redirect: 'manual', maxBytes: 2 * 1024 * 1024 });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw new ModelProviderError('读取模型列表超时，请稍后重试。');
        throw new ModelProviderError('无法连接模型服务，请检查 API 地址和网络连接。');
      }
      if (response.status >= 300 && response.status < 400) throw new ModelProviderError('API 地址发生跳转，请填写服务的最终 API 地址后重试。');
      if (response.status === 401 || response.status === 403) throw new ModelProviderError('API Key 无效或没有读取模型列表的权限。');
      if (response.status === 404) throw new ModelProviderError('此地址不支持读取模型列表，请检查 API 地址，或手动添加模型 ID。');
      if (!response.ok) throw new ModelProviderError(`模型服务暂时无法读取列表（HTTP ${response.status}），请稍后重试。`);
      // Never echo remote response bodies: they may contain credentials or diagnostic secrets.
      const payload = await response.json().catch(() => null);
      const entries = input.apiStyle === 'gemini' ? payload?.models : payload?.data;
      if (!Array.isArray(entries)) throw new ModelProviderError('服务没有返回有效的模型列表，请手动添加模型 ID。');
      for (const entry of entries) {
        if (input.apiStyle === 'gemini' && Array.isArray(entry?.supportedGenerationMethods)
          && !entry.supportedGenerationMethods.includes('generateContent')) continue;
        const rawId = input.apiStyle === 'gemini' ? entry?.name : entry?.id;
        if (typeof rawId !== 'string') continue;
        const id = input.apiStyle === 'gemini' ? rawId.replace(/^models\//, '') : rawId;
        if (id && id.length <= 200 && !/[\s\x00-\x1f\x7f]/.test(id)) models.add(id);
      }
      if (models.size > 2000) throw new ModelProviderError('服务返回的模型过多，请手动添加所需模型 ID。');
      const cursor = input.apiStyle === 'gemini' ? payload.nextPageToken
        : input.apiStyle === 'anthropic' && payload.has_more ? payload.last_id : undefined;
      if (!cursor) {
        if (!models.size) throw new ModelProviderError('没有找到可添加的模型，请手动填写模型 ID。');
        return [...models].sort((a, b) => a.localeCompare(b));
      }
      if (typeof cursor !== 'string' || cursor.length > 4096 || cursors.has(cursor)) break;
      cursors.add(cursor);
      url.searchParams.set(input.apiStyle === 'gemini' ? 'pageToken' : 'after_id', cursor);
    }
    throw new ModelProviderError('模型列表未能完整读取，请重试或手动添加模型 ID。');
  });
}
