import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { registerExtra } from './registry.ts';
import { modelUsageStore } from '../../.generated/catpaw/electron/services/model-usage-store';

const pending = new Map<string, { owner: number; finish(answer: boolean): void }>();

export function registerModelConfirmationHandler() {
  registerExtra('answerModelConfirmation', async ({ sender }, [id, answer]) => {
    if (typeof id !== 'string' || typeof answer !== 'boolean') throw new Error('INVALID_MODEL_CONFIRMATION');
    const question = pending.get(id);
    if (!question || question.owner !== sender.id) throw new Error('MODEL_CONFIRMATION_EXPIRED');
    question.finish(answer);
    return { ok: true };
  });
}

/** The browser owning the request must answer; native dialogs would be invisible remotely. */
export function confirmModelRequests(sender: WebContents, task: '摘要' | '翻译', requests: number, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  if (requests <= 1) return Promise.resolve(true);
  if (sender.isDestroyed() || [...pending.values()].some(item => item.owner === sender.id)) return Promise.resolve(false);
  const usage = modelUsageStore.get();
  const limit = usage.dailyTokenLimit === null ? '每日用量上限尚未开启，可在摘要设置或翻译设置中启用。'
    : `今日已计入 ${usage.usedTokens.toLocaleString('zh-CN')} / ${usage.dailyTokenLimit.toLocaleString('zh-CN')} Token（含预留用量）。`;
  return new Promise(resolve => {
    const id = randomUUID();
    const cancel = () => finish(false);
    const finish = (answer: boolean) => {
      if (!pending.delete(id)) return;
      clearTimeout(timer); signal.removeEventListener('abort', cancel); sender.removeListener('destroyed', cancel);
      if (!sender.isDestroyed()) sender.send('catpaw:modelConfirmationClosed', { id });
      resolve(answer);
    };
    const timer = setTimeout(cancel, 120_000); timer.unref();
    pending.set(id, { owner: sender.id, finish });
    signal.addEventListener('abort', cancel, { once: true }); sender.once('destroyed', cancel);
    sender.send('catpaw:modelConfirmation', { id, title: '长文用量提示', confirmLabel: `继续${task}`,
      detail: `这篇长文预计至少需要 ${requests} 次模型请求才能完成${task}，重试或合并可能增加请求。每次请求都可能产生费用，并计入摘要与翻译共享的每日用量。\n\n${limit}\nHarness 模型按预估用量计入；实际费用以模型服务账单为准。` });
  });
}
