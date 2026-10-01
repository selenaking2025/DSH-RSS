import { randomUUID } from 'node:crypto';
import { HARNESS_BASE_URL, HARNESS_PROVIDER_ID } from '../shared/model.ts';
import { isRecord } from '../shared/protocol.ts';
import { ModelProviderError, type ModelProvider } from '../../.generated/catpaw/electron/contracts/model-providers';
import { ModelTextError } from '../../.generated/catpaw/electron/services/model-text';

const pending = new Map<string, { resolve(value: string): void; reject(error: Error): void; clean(): void }>();
process.on('message', (message: unknown) => {
  if (!isRecord(message) || message.kind !== 'model-response' || typeof message.id !== 'string') return;
  const request = pending.get(message.id); if (!request) return;
  pending.delete(message.id); request.clean();
  if (message.ok === true && typeof message.text === 'string' && message.text.length <= 120000) request.resolve(message.text);
  else request.reject(new ModelTextError(typeof message.error === 'string' ? message.error.slice(0, 500) : 'Harness 模型返回无效结果。'));
});
process.on('disconnect', () => { for (const item of pending.values()) { item.clean(); item.reject(new Error('HARNESS_DISCONNECTED')); } pending.clear(); });
export function harnessProvider(): ModelProvider[] {
  const model = process.env.CATPAW_HARNESS_MODEL;
  return model ? [{ id: HARNESS_PROVIDER_ID, kind: 'custom', displayName: 'Harness 已配置模型', apiStyle: 'openai-compat',
    baseUrl: HARNESS_BASE_URL, models: [model], keyConfigured: true, keyNeedsReentry: false }] : [];
}
export function guardHarnessProvider(id: string) {
  if (id === HARNESS_PROVIDER_ID) throw new ModelProviderError('此模型由 Harness 管理，请在 Harness 模型设置和 Catpaw 插件配置中修改。');
}
export function requestHarnessModel(model: string, system: string, content: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (!process.connected || model !== process.env.CATPAW_HARNESS_MODEL) throw new ModelTextError('Harness 模型尚未配置或已更改，请重新选择。');
  if (pending.size >= 4) throw new ModelTextError('Harness 模型正在处理其他阅读任务，请稍后重试。');
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      pending.delete(id); clean();
      if (process.connected) process.send?.({ kind: 'model-cancel', id }, () => {});
      reject(new ModelTextError(signal.aborted ? '模型请求已取消。' : 'Harness 模型请求超时，请重试。'));
    };
    const timer = setTimeout(cancel, 90_000);
    const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
    pending.set(id, { resolve, reject, clean }); signal.addEventListener('abort', cancel, { once: true });
    process.send?.({ kind: 'model-request', id, model, system, content }, error => {
      if (!error || !pending.delete(id)) return; clean(); reject(new ModelTextError('Harness 模型连接已关闭。'));
    });
  });
}
