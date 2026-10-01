import { fetchWithTimeout } from '../network/http';
import { normalizeModelBaseUrl, type ModelApiStyle } from '../contracts/model-providers';

export type ModelTextTarget = { baseUrl: string; apiStyle: ModelApiStyle; model: string; apiKey?: string };
export class ModelTextError extends Error {
  constructor(message: string, readonly incomplete = false) { super(message); }
}

function requestBody(target: ModelTextTarget, system: string, content: string) {
  const base = normalizeModelBaseUrl(target.baseUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (target.apiStyle === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (target.apiKey) headers['x-api-key'] = target.apiKey;
    return { url: `${base}/messages`, headers, body: {
      model: target.model, system, max_tokens: 8192, messages: [{ role: 'user', content }],
    } };
  }
  if (target.apiStyle === 'gemini') {
    if (target.apiKey) headers['x-goog-api-key'] = target.apiKey;
    return { url: `${base}/models/${encodeURIComponent(target.model)}:generateContent`, headers, body: {
      systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: content }] }],
      generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json' },
    } };
  }
  if (target.apiKey) headers.Authorization = `Bearer ${target.apiKey}`;
  return { url: `${base}/chat/completions`, headers, body: {
    model: target.model, stream: false,
    ...(/^(gpt-5|o\d)/.test(target.model) ? { max_completion_tokens: 8192 } : { max_tokens: 8192 }),
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
  } };
}

function responseText(payload: any, style: ModelApiStyle, task: string): string {
  let reason: unknown;
  let text: unknown;
  if (style === 'anthropic') {
    reason = payload?.stop_reason;
    text = Array.isArray(payload?.content) ? payload.content.filter((block: any) => block?.type === 'text').map((block: any) => block.text).join('') : null;
  } else if (style === 'gemini') {
    const candidate = payload?.candidates?.[0];
    reason = candidate?.finishReason;
    text = Array.isArray(candidate?.content?.parts) ? candidate.content.parts.filter((part: any) => !part.thought && typeof part.text === 'string').map((part: any) => part.text).join('') : null;
  } else {
    reason = payload?.choices?.[0]?.finish_reason;
    text = payload?.choices?.[0]?.message?.content;
  }
  if (!['stop', 'end_turn', 'STOP'].includes(reason as string) || typeof text !== 'string' || !text.trim()) {
    const truncated = ['length', 'max_tokens', 'MAX_TOKENS'].includes(reason as string);
    throw new ModelTextError(truncated
      ? `模型输出达到长度上限，没有返回完整${task === '翻译' ? '译文' : task}。请检查模型的输出长度或上下文设置。`
      : `模型没有返回完整${task === '翻译' ? '译文' : task}，请重试或更换模型。`,
    truncated || ['stop', 'end_turn', 'STOP'].includes(reason as string));
  }
  return text;
}

/** Shared provider protocols; credentials and raw provider errors never cross IPC. */
export async function requestModelText(target: ModelTextTarget, system: string, content: string, signal: AbortSignal, task: string) {
  signal.throwIfAborted();
  const request = requestBody(target, system, content);
  let response: Response;
  try {
    response = await fetchWithTimeout(request.url, {
      method: 'POST', headers: request.headers, body: JSON.stringify(request.body), signal,
      redirect: 'manual', maxBytes: 2 * 1024 * 1024,
    }, 90_000);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ModelTextError(error instanceof Error && error.name === 'AbortError'
      ? `${task}请求超时，请重试或更换模型。` : `无法连接${task}服务，请检查网络和 API 地址。`);
  }
  if (response.status === 401 || response.status === 403) throw new ModelTextError(`${task}服务拒绝了请求，请检查 API Key 和模型权限。`);
  if (response.status === 429) throw new ModelTextError(`${task}服务额度不足或请求过于频繁，请稍后重试。`);
  if (response.status >= 300 && response.status < 400) throw new ModelTextError(`${task}服务地址发生跳转，请在 API Key 设置中填写最终 API 地址。`);
  if (!response.ok) throw new ModelTextError(`${task}服务返回错误（HTTP ${response.status}），请检查所选模型和 API 设置。`);
  return responseText(await response.json().catch(() => null), target.apiStyle, task);
}
