import { randomUUID } from 'node:crypto';
import { setTimeout as yieldTask } from 'node:timers/promises';
import { DecisionError, decisionCacheKey } from '../contracts/decision';
import { ReadingError, type ReadingChange, type ReadingRunInput, type ReadingStatus } from '../contracts/smart-reading';
import { activeReadingFocuses, getReadingFocus } from '../data/reading-focus-repo';
import { countReadingCandidates, listReadingCandidates } from '../data/reading-entry-repo';
import { decisionSettings } from './decision-settings';
import { analyzeReadingCandidate } from './reading-analysis';
import { readingWindow } from './reading-results';
import { withRequestBudget } from '../network/http';
import { testDecisionConnection } from '../providers/jev';

export class SmartReadingService {
  private current: ReadingStatus | null = null;
  private running: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private listeners = new Set<(change: ReadingChange) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wake: ReturnType<typeof setInterval> | null = null;
  private paused = 0;
  private stopped = false;
  private begun = false;
  private probes = new Map<AbortController, Promise<unknown>>();
  testConnection(signal: AbortSignal) {
    if (this.stopped) throw new ReadingError('应用正在退出，请稍后重试。');
    const controller = new AbortController();
    const pending = decisionSettings.target().then((target) => testDecisionConnection(target,
      AbortSignal.any([signal, controller.signal, AbortSignal.timeout(60_000)]))).finally(() => this.probes.delete(controller));
    this.probes.set(controller, pending); return pending;
  }
  getStatus() { return this.current ? { ...this.current } : null; }
  subscribe(listener: (change: ReadingChange) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  changed(kind: ReadingChange['kind']) { for (const listener of this.listeners) listener({ kind }); }
  private update(patch: Partial<ReadingStatus>) {
    if (!this.current) return;
    this.current = { ...this.current, ...patch, updatedAt: Date.now() }; this.changed('status');
  }
  start(input: ReadingRunInput = {}) {
    if (this.stopped || this.paused) throw new ReadingError('智能阅读正在等待维护完成，请稍后重试。');
    if (this.running) throw new ReadingError('智能阅读正在处理中，可以先停止当前任务。');
    const settings = decisionSettings.get();
    if (!settings.enabled || !settings.keyConfigured) throw new DecisionError('请先在智能阅读设置中配置并开启 Jev 筛选。', 'CONFIG_REQUIRED');
    const window = readingWindow(input);
    const focus = input.focusId ? getReadingFocus(input.focusId) : null;
    const focuses = (input.focusId ? (focus ? [focus] : []) : activeReadingFocuses())
      .filter((item) => item.enabled && !item.archived && (item.expiresAt === null || item.expiresAt > Date.now()))
      .sort((a, b) => b.priority - a.priority);
    if (!focuses.length) throw new ReadingError('请先创建并启用一个关注事项。');
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const controller = new AbortController(); this.controller = controller;
    this.current = { id: randomUUID(), phase: 'running', completed: 0,
      total: focuses.reduce((n, item) => n + countReadingCandidates(item, window), 0), errors: 0, message: null, updatedAt: Date.now() };
    this.changed('status');
    this.running = withRequestBudget({ priority: 'background', perHostConcurrency: 1, deadlineAt: Date.now() + 30 * 60_000,
      shouldStop: () => controller.signal.aborted }, async () => {
      const target = await decisionSettings.target();
      for (const interest of focuses) {
        let after = '';
        for (;;) {
          controller.signal.throwIfAborted();
          if (getReadingFocus(interest.id)?.revision !== interest.revision) throw new ReadingError('关注事项已更改，请重新筛选。');
          const candidates = listReadingCandidates(interest, window, decisionCacheKey(target), after, 30);
          if (!candidates.length) break;
          for (const candidate of candidates) {
            controller.signal.throwIfAborted(); after = candidate.id;
            try {
              await analyzeReadingCandidate(candidate, interest, window, target, settings.revision, controller.signal);
            } catch (error) {
              controller.signal.throwIfAborted();
              if (error instanceof DecisionError) throw error;
              this.update({ errors: this.current!.errors + 1, message: '部分文章暂时未能完成判断，可稍后重试。' });
            }
            this.update({ completed: this.current!.completed + 1 });
            await yieldTask(0, undefined, { signal: controller.signal });
          }
          this.changed('results');
        }
      }
      this.update({ phase: this.current!.errors ? 'failed' : 'completed',
        ...(this.current!.total === 0 ? { message: window.onlyUnread
          ? '当前范围没有未读文章，可以取消“只看未读”后重新筛选。'
          : '当前日期和订阅范围内没有文章，请调整筛选范围。' } : {}) });
    }).catch((error) => {
      this.update({ phase: controller.signal.aborted ? 'cancelled' : 'failed', message: controller.signal.aborted
        ? '已停止，已完成的判断已保留。' : error instanceof DecisionError || error instanceof ReadingError ? error.message : '智能阅读处理失败，请稍后重试。' });
    }).finally(() => { this.running = null; this.controller = null; this.changed('results'); });
    return this.getStatus()!;
  }
  async cancel() { this.controller?.abort(); await this.running; }
  pause() {
    this.paused++; this.controller?.abort();
    let resumed = false;
    return { drained: this.running ?? Promise.resolve(), resume: () => { if (resumed) return; resumed = true; this.paused--; this.schedule(); } };
  }
  schedule() {
    if (!this.begun || this.timer || this.stopped || this.paused) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped || this.paused || this.running) return;
      try { if (decisionSettings.get().enabled && activeReadingFocuses().length) this.start(); } catch { /* Visible configuration is retried on the next change. */ }
    }, 2000);
    this.timer.unref();
  }
  begin() { if (this.begun || this.stopped) return; this.begun = true; this.schedule(); this.wake = setInterval(() => this.schedule(), 300_000); this.wake.unref(); }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer); if (this.wake) clearInterval(this.wake);
    for (const controller of this.probes.keys()) controller.abort();
    await Promise.allSettled([this.cancel(), ...this.probes.values()]);
  }
}
export const smartReading = new SmartReadingService();
