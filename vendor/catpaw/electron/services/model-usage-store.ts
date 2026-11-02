import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureUserDataDir } from '../runtime';
import { isDailyModelTokenLimit, ModelUsageError, type ModelUsageStatus } from '../contracts/model-usage';

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Main-process owned, outside database restores. Reservations are durable before dispatch. */
export class ModelUsageStore {
  constructor(private readonly directory: () => string = ensureUserDataDir, private readonly now: () => Date = () => new Date()) {}

  private get file() { return path.join(this.directory(), 'model-usage.json'); }

  get(): ModelUsageStatus {
    const day = localDay(this.now());
    try {
      let state: ModelUsageStatus = { dailyTokenLimit: null, day, usedTokens: 0, requests: 0, estimatedRequests: 0 };
      try {
        if (fs.statSync(this.file).size > 4096) throw new Error();
        const raw = fs.readFileSync(this.file, 'utf8');
        if (raw.length > 4096) throw new Error();
        const data = JSON.parse(raw);
        if (data.version !== 1 || !isDailyModelTokenLimit(data.dailyTokenLimit)
          || typeof data.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.day)
          || !count(data.usedTokens) || !count(data.requests) || !count(data.estimatedRequests)
          || data.estimatedRequests > data.requests) throw new Error();
        state = { dailyTokenLimit: data.dailyTokenLimit, day: data.day, usedTokens: data.usedTokens,
          requests: data.requests, estimatedRequests: data.estimatedRequests };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      // Clock rollback must not reopen a spent budget. Late results keep their dispatch day.
      return day > state.day ? { ...state, day, usedTokens: 0, requests: 0, estimatedRequests: 0 } : state;
    } catch {
      throw new ModelUsageError('无法读取摘要和翻译的每日用量，已停止模型请求。原有记录已保留，请检查应用数据目录后重试。');
    }
  }

  private write(state: ModelUsageStatus) {
    const file = this.file;
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, ...state }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } catch {
      throw new ModelUsageError('无法保存摘要和翻译的每日用量，已停止后续模型请求。请检查磁盘空间和目录权限。');
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch { /* Preserve the actionable storage error. */ }
    }
  }

  setLimit(dailyTokenLimit: number | null): ModelUsageStatus {
    if (!isDailyModelTokenLimit(dailyTokenLimit)) throw new ModelUsageError('每日上限须为 1–1,000,000,000 的整数，或关闭限制。');
    const state = { ...this.get(), dailyTokenLimit };
    this.write(state);
    return state;
  }

  reserve(tokens: number): (actualTokens: number | null) => void {
    if (!count(tokens) || tokens === 0) throw new ModelUsageError('无法估算本次模型用量，已停止请求。');
    const state = this.get();
    const total = state.usedTokens + tokens;
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(state.requests + 1)) throw new ModelUsageError('每日用量记录已达到上限，已停止模型请求。');
    if (state.dailyTokenLimit !== null && total > state.dailyTokenLimit) {
      const remaining = Math.max(0, state.dailyTokenLimit - state.usedTokens);
      throw new ModelUsageError(`摘要和翻译共用的每日额度不足：剩余 ${remaining.toLocaleString('zh-CN')} Token，本次请求需预留 ${tokens.toLocaleString('zh-CN')} Token。已停止后续请求；可在摘要设置或翻译设置中调整上限，或明天再试。`);
    }
    // No await between check and write: concurrent summary/translation requests share this balance.
    this.write({ ...state, usedTokens: total, requests: state.requests + 1, estimatedRequests: state.estimatedRequests + 1 });
    let settled = false;
    return (actualTokens) => {
      if (settled) return;
      settled = true;
      // Errors, cancellation, missing/invalid provider usage and crashes retain the reservation.
      if (!count(actualTokens) || actualTokens === 0) return;
      const current = this.get();
      if (current.day !== state.day) return;
      const usedTokens = current.usedTokens - tokens + actualTokens;
      if (!count(usedTokens)) throw new ModelUsageError('模型用量记录异常，已停止后续请求。');
      this.write({ ...current, usedTokens, estimatedRequests: current.estimatedRequests - 1 });
    };
  }
}

export const modelUsageStore = new ModelUsageStore();
