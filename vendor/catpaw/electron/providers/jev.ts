import { setTimeout as delay } from 'node:timers/promises';
import { currentRequestBudget, fetchWithTimeout } from '../network/http';
import { normalizeModelBaseUrl } from '../contracts/model-providers';
import { DecisionError, type DecisionAnswer, type DecisionQuestion, type DecisionResult, type DecisionTarget } from '../contracts/decision';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function invalid(): never { throw new DecisionError('Jev 返回了不完整或无效的判断，请重试。'); }

function transportFailure(error: unknown) {
  const value = error as { name?: string; message?: string; code?: string; cause?: { code?: string } } | null;
  const code = value?.code ?? value?.cause?.code;
  if (value?.message === 'REQUEST_BUDGET_EXHAUSTED') return { kind: 'budget', retryable: false, message: '本轮筛选已达到运行时限，已完成的判断已保留，可以继续筛选。' };
  if (value?.message === 'RESPONSE_TOO_LARGE') return { kind: 'response_size', retryable: false, message: 'Jev 返回的数据超出大小限制，请稍后重试。' };
  if (code && /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return { kind: 'tls', retryable: false, message: '无法与 Jev 建立安全连接，请检查服务地址或网络代理。' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { kind: 'dns', retryable: true, message: '无法解析 Jev 服务地址，请检查网络或代理。' };
  if (value?.name === 'TimeoutError' || /^Request timed out after \d+ms$/.test(value?.message ?? '')
    || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code ?? '')) {
    return { kind: 'timeout', retryable: true, message: '等待 Jev 响应超时，请稍后重试。' };
  }
  return { kind: 'connection', retryable: true, message: '连接 Jev 时中断，请检查网络或代理后重试。' };
}

async function retryDelay(attempt: number, signal: AbortSignal, retryAfter: string | null = null) {
  const after = Number(retryAfter);
  const milliseconds = Math.min(10_000, Math.max(500 * 2 ** attempt, Number.isFinite(after) ? after * 1000 : 0));
  const budget = currentRequestBudget();
  if (budget?.shouldStop?.()) { signal.throwIfAborted(); throw new DecisionError('筛选已停止，已完成的判断已保留。'); }
  if (Date.now() + milliseconds >= (budget?.deadlineAt ?? Infinity)) {
    throw new DecisionError('本轮筛选已达到运行时限，已完成的判断已保留，可以继续筛选。');
  }
  await delay(milliseconds, undefined, { signal });
}

export function parseDecisionResult(payload: unknown, questions: Record<string, DecisionQuestion>): DecisionResult {
  if (!record(payload) || typeof payload.model !== 'string' || !payload.model || !record(payload.answers) || !record(payload.usage)) invalid();
  const usage = payload.usage;
  if (![usage.input_tokens, usage.output_tokens].every((value) => Number.isSafeInteger(value) && (value as number) >= 0)) invalid();
  const answers: Record<string, DecisionAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = payload.answers[id];
    if (!record(answer) || answer.type !== question.type) invalid();
    if (question.type === 'noul') {
      if (!probability(answer.noul)) invalid();
      answers[id] = { type: 'noul', noul: answer.noul }; continue;
    }
    if (!probability(answer.confidence) || !record(answer.probabilities)) invalid();
    const keys = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, i) => String(i));
    let sum = 0, expected = 0;
    for (const [key, value] of Object.entries(answer.probabilities)) {
      if (!keys.includes(key) || !probability(value)) invalid();
      sum += value; if (question.type === 'score') expected += Number(key) * value;
    }
    if (Math.abs(sum - 1) > 0.02) invalid();
    const probabilities = answer.probabilities as Record<string, number>;
    if (question.type === 'choice') {
      if (typeof answer.choice !== 'string' || !keys.includes(answer.choice) || probabilities[answer.choice] === undefined) invalid();
      answers[id] = { type: 'choice', choice: answer.choice, confidence: answer.confidence, probabilities };
    } else {
      if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0
        || answer.score > keys.length - 1 || Math.abs(expected - answer.score) > 0.05) invalid();
      answers[id] = { type: 'score', score: answer.score, confidence: answer.confidence, probabilities };
    }
  }
  return { model: payload.model, answers, inputTokens: usage.input_tokens as number, outputTokens: usage.output_tokens as number };
}

export async function requestDecision(target: DecisionTarget, state: unknown, questions: Record<string, DecisionQuestion>, signal: AbortSignal,
  beforeAttempt?: () => Promise<void>): Promise<DecisionResult> {
  if (!Object.keys(questions).length || Object.keys(questions).length > 100) throw new DecisionError('判断问题数量超出限制。');
  const body = JSON.stringify({ model: target.model, state, questions });
  if (Buffer.byteLength(body) > 110_000) throw new DecisionError('判断内容过长，请分段处理。');
  const url = `${normalizeModelBaseUrl(target.baseUrl)}/systemone`;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    await beforeAttempt?.();
    signal.throwIfAborted();
    let response: Response;
    const started = Date.now();
    try {
      response = await fetchWithTimeout(url, { method: 'POST', redirect: 'manual', signal,
        headers: { Authorization: `Bearer ${target.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body, maxBytes: 1024 * 1024 }, 45_000);
    } catch (error) {
      signal.throwIfAborted();
      const failure = transportFailure(error);
      // Never log the request, credentials, article text or raw transport error.
      console.warn('[jev] request failed', { attempt: attempt + 1, kind: failure.kind, elapsedMs: Date.now() - started });
      if (failure.retryable && attempt < 2) { await retryDelay(attempt, signal); continue; }
      throw new DecisionError(`${failure.message}${attempt ? `已自动重试 ${attempt} 次，已完成的判断仍然保留。` : ''}`);
    }
    if ([429, 500, 502, 503, 504, 529].includes(response.status) && attempt < 2) {
      console.warn('[jev] request failed', { attempt: attempt + 1, status: response.status, elapsedMs: Date.now() - started });
      await retryDelay(attempt, signal, response.headers.get('retry-after'));
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new DecisionError('Jev 拒绝了请求，请检查 API Key 和模型权限。', 'CONFIG_REQUIRED');
    if (response.status >= 300 && response.status < 400) throw new DecisionError('Jev 服务地址发生跳转，请检查设置中的最终地址。');
    if (response.status === 429) throw new DecisionError('Jev 额度不足或请求过于频繁，请稍后重试。', 'LIMIT');
    if (!response.ok) throw new DecisionError(`Jev 服务返回错误（HTTP ${response.status}），请稍后重试。`);
    const result = parseDecisionResult(await response.json().catch(() => null), questions);
    if (target.model !== 'jev-latest' && target.model !== 'jev-preview' && result.model !== target.model) {
      throw new DecisionError('Jev 返回的模型版本与设置不一致，请检查模型配置。');
    }
    return result;
  }
  throw new DecisionError('Jev 暂时繁忙，请稍后重试。');
}

export async function testDecisionConnection(target: DecisionTarget, signal: AbortSignal) {
  const result = await requestDecision(target, 'Catpaw connection test. The application is an RSS reader.', {
    connection: { type: 'noul', instructions: 'Does the state describe an RSS reader?' },
  }, signal);
  return { model: result.model, inputTokens: result.inputTokens };
}
