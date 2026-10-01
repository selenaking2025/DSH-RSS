import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const enabled = process.env.CATPAW_PERFORMANCE_METRICS === '1';
const names = ['ipc', 'queue.wait', 'database.transaction', 'browser.wait', 'network.wait'] as const;
type Metric = typeof names[number];
const samples = new Map<Metric, { count: number; total: number; max: number; values: number[] }>();
let loop: ReturnType<typeof monitorEventLoopDelay> | undefined;
export function startPerformanceMetrics() {
  if (!enabled || loop) return;
  loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
}
export function recordMetric(metric: Metric, milliseconds: number) {
  if (!enabled) return;
  if (process.send && process.env.CATPAW_REQUEST_BROKER === '1') {
    if (process.connected) process.send({ type: 'telemetry:sample', metric, milliseconds }, () => {});
    return;
  }
  const row = samples.get(metric) ?? { count: 0, total: 0, max: 0, values: [] };
  row.values[row.count % 5000] = milliseconds;
  row.count++; row.total += milliseconds; row.max = Math.max(row.max, milliseconds);
  samples.set(metric, row);
}
export function acceptPerformanceMetric(input: unknown) {
  const message = input as { type?: string; metric?: Metric; milliseconds?: number };
  if (message?.type !== 'telemetry:sample') return false;
  if (!names.includes(message.metric!) || !Number.isFinite(message.milliseconds) || message.milliseconds! < 0) throw new Error('INVALID_PERFORMANCE_SAMPLE');
  recordMetric(message.metric!, message.milliseconds!);
  return true;
}
export function measureTransaction<T>(operation: () => T): T {
  if (!enabled) return operation();
  const start = performance.now();
  try { return operation(); } finally { recordMetric('database.transaction', performance.now() - start); }
}
export function resetPerformanceMetrics() { samples.clear(); loop?.reset(); }
export function performanceSnapshot() {
  return {
    enabled,
    eventLoop: loop ? { meanMs: loop.mean / 1e6, p95Ms: loop.percentile(95) / 1e6, maxMs: loop.max / 1e6 } : null,
    metrics: Object.fromEntries([...samples].map(([name, row]) => {
      const sorted = [...row.values].sort((a, b) => a - b);
      return [name, { count: row.count, meanMs: row.total / row.count, maxMs: row.max,
        p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], retainedSamples: sorted.length }];
    })),
  };
}
