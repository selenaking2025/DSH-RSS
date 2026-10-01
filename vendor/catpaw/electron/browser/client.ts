import { randomUUID } from 'node:crypto';
import { currentRequestBudget } from '../network/http';
import type { BrowserRequest, BrowserResult } from './protocol';

export async function browserRequest(input: BrowserRequest): Promise<BrowserResult> {
  const budget = currentRequestBudget();
  if (input.kind === 'html') input = { ...input, priority: input.priority ?? budget?.priority ?? 'interactive' };
  if (!process.send) {
    const { runBrowserRequest } = await import('./host');
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error('BROWSER_CANCELLED'));
    const timer = setTimeout(cancel, Math.max(1, Math.min(60_000, (budget?.deadlineAt ?? Infinity) - Date.now())));
    const poll = setInterval(() => { if (budget?.shouldStop?.()) cancel(); }, 50);
    if (budget?.shouldStop?.()) cancel();
    try { return await runBrowserRequest(input, controller.signal); }
    finally { clearTimeout(timer); clearInterval(poll); }
  }
  const id = randomUUID();
  return new Promise<BrowserResult>((resolve, reject) => {
    let settled = false;
    let cancelled = false;
    const finish = (error?: Error, result?: BrowserResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearInterval(cancelPoll);
      process.removeListener('message', receive);
      process.removeListener('disconnect', disconnected);
      if (error) reject(error); else resolve(result!);
    };
    const receive = (message: any) => {
      if (message?.type === 'browser:result' && message.id === id) finish(cancelled ? new Error('BROWSER_CANCELLED')
        : message.error ? new Error(message.error) : undefined, message.result);
    };
    const cancel = () => {
      if (cancelled || settled) return;
      cancelled = true;
      if (process.connected) process.send?.({ type: 'browser:cancel', id }, () => {});
      // Host acknowledges only after its window and queue permit are released.
      else finish(new Error('BROWSER_HOST_DISCONNECTED'));
    };
    const disconnected = () => finish(new Error('BROWSER_HOST_DISCONNECTED'));
    const timer = setTimeout(cancel, Math.max(1, Math.min(60_000, (budget?.deadlineAt ?? Infinity) - Date.now())));
    const cancelPoll = setInterval(() => { if (budget?.shouldStop?.()) cancel(); }, 50);
    process.on('message', receive);
    process.once('disconnect', disconnected);
    process.send!({ type: 'browser:request', id, input }, (error: Error | null) => { if (error) finish(error); });
  });
}

export async function browserHtml(url: string, selector?: '#js_content') {
  const result = await browserRequest({ kind: 'html', url, selector,
    session: selector === '#js_content' || new URL(url).hostname === 'mp.weixin.qq.com' ? 'wechat' : 'public' });
  if (!('html' in result)) throw new Error('BROWSER_INVALID_RESPONSE');
  return result.html;
}
