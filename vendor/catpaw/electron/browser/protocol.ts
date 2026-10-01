import type { BackgroundJobPriority } from '../contracts/background-jobs';
export type BrowserRequest = { kind: 'html'; url: string; selector?: '#js_content';
  session?: 'public' | 'wechat'; priority?: BackgroundJobPriority } | { kind: 'wechat-login' };
export type BrowserResult = { html: string } | { ok: true; alreadyOpen?: boolean };
