import type { BackgroundJobPriority } from '../contracts/background-jobs';
export type BrowserRequest = { kind: 'html'; url: string; selector?: '#js_content';
  session?: 'public' | 'wechat'; priority?: BackgroundJobPriority } | { kind: 'wechat-login' }
  | { kind: 'linuxdo-login' }
  | { kind: 'linuxdo-feed'; url: string; headers?: Record<string, string>; priority?: BackgroundJobPriority };
export type BrowserResult = { html: string } | { ok: true; alreadyOpen?: boolean }
  | { status: number; body: string; headers: Record<string, string> };
