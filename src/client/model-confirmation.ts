import type { createBridge } from './bridge.ts';
import type { Question } from './confirmation.tsx';
import { isRecord } from '../shared/protocol.ts';

export function installModelConfirmations(bridge: ReturnType<typeof createBridge>, ask: (question: Question, signal?: AbortSignal) => Promise<boolean>) {
  const pending = new Map<string, AbortController>();
  const removeQuestion = bridge.onEvent('catpaw:modelConfirmation', value => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string'
      || typeof value.detail !== 'string' || typeof value.confirmLabel !== 'string' || pending.has(value.id)) return;
    const id = value.id, controller = new AbortController(); pending.set(id, controller);
    void ask({ title: value.title, detail: value.detail, confirmLabel: value.confirmLabel }, controller.signal)
      .then(answer => controller.signal.aborted ? undefined : bridge.request('answerModelConfirmation', [id, answer]))
      .catch(() => {}).finally(() => pending.delete(id));
  });
  const removeClosed = bridge.onEvent('catpaw:modelConfirmationClosed', value => {
    if (isRecord(value) && typeof value.id === 'string') pending.get(value.id)?.abort();
  });
  return () => { removeQuestion(); removeClosed(); for (const controller of pending.values()) controller.abort(); pending.clear(); };
}
