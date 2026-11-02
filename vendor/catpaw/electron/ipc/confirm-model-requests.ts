import { BrowserWindow, dialog, type WebContents } from 'electron';
import { modelUsageStore } from '../services/model-usage-store';

export async function confirmModelRequests(sender: WebContents, task: '摘要' | '翻译', requests: number, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  if (requests <= 1) return true;
  const window = BrowserWindow.fromWebContents(sender);
  if (!window || window.isDestroyed()) return false;
  const usage = modelUsageStore.get();
  const limit = usage.dailyTokenLimit === null ? '每日用量上限尚未开启，可在摘要设置或翻译设置中启用。'
    : `今日已计入 ${usage.usedTokens.toLocaleString('zh-CN')} / ${usage.dailyTokenLimit.toLocaleString('zh-CN')} Token（含预留用量）。`;
  const result = await dialog.showMessageBox(window, {
    type: 'question', title: '长文用量提示', message: `这篇长文需要多次模型请求才能完成${task}`,
    detail: `预计至少 ${requests} 次请求。${task === '摘要' ? '长文会分段处理，再合并摘要；进一步合并可能增加请求。' : '译文不完整时会拆分重试，实际请求次数可能更多。'}每次请求都可能产生费用，并计入摘要与翻译共享的每日用量。\n\n${limit}\nToken 用量不等于金额，实际费用以模型服务账单为准。`,
    buttons: [task === '摘要' ? '继续生成' : '继续翻译', '取消'], defaultId: 1, cancelId: 1, noLink: true, signal,
  });
  signal.throwIfAborted();
  return result.response === 0;
}
