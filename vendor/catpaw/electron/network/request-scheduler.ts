import { BACKGROUND_JOB_PRIORITY_WEIGHT, type BackgroundJobPriority } from '../contracts/background-jobs';

export type RequestSlot = { key: string; limit: number; priority: BackgroundJobPriority };
type Waiting = RequestSlot & { grant: () => void; cancel: () => void };

/** One owner grants permits; cancellation never consumes capacity. */
export class RequestScheduler {
  private active = new Map<string, Set<number>>();
  private permits = new Map<number, RequestSlot>();
  private waiting: Waiting[] = [];
  private sequence = 0;
  constructor(private readonly capacity = Infinity) {}

  acquire(input: RequestSlot, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason ?? new Error('REQUEST_CANCELLED'));
    if (this.waiting.length >= 500) return Promise.reject(new Error('REQUEST_QUEUE_FULL'));
    return new Promise((resolve, reject) => {
      const item: Waiting = { ...input,
        cancel: () => {
          this.waiting = this.waiting.filter((entry) => entry !== item);
          signal.removeEventListener('abort', item.cancel);
          reject(signal.reason ?? new Error('REQUEST_CANCELLED'));
        },
        grant: () => {
          signal.removeEventListener('abort', item.cancel);
          const id = ++this.sequence;
          const active = this.active.get(input.key) ?? new Set<number>();
          active.add(id); this.active.set(input.key, active); this.permits.set(id, input);
          resolve(() => {
            if (!this.permits.delete(id)) return;
            active.delete(id); if (!active.size) this.active.delete(input.key);
            this.pump();
          });
        },
      };
      this.waiting.push(item);
      this.waiting.sort((a, b) => BACKGROUND_JOB_PRIORITY_WEIGHT[b.priority] - BACKGROUND_JOB_PRIORITY_WEIGHT[a.priority]);
      signal.addEventListener('abort', item.cancel, { once: true });
      this.pump();
    });
  }
  private pump() {
    while (this.permits.size < this.capacity) {
      const index = this.waiting.findIndex((item) => {
        const active = this.active.get(item.key);
        const limit = Math.min(item.limit, ...[...(active ?? [])].map((id) => this.permits.get(id)!.limit));
        return (active?.size ?? 0) < limit;
      });
      if (index < 0) break;
      this.waiting.splice(index, 1)[0].grant();
    }
  }
  snapshot() { return { active: this.permits.size, waiting: this.waiting.length }; }
}
