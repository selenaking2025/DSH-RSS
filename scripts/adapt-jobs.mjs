import { readFile, writeFile } from 'node:fs/promises';

export async function adaptRssJobs(importPath) {
  const file = '.generated/catpaw/electron/rss-job-manager.ts';
  let source = await readFile(file, 'utf8');
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Imported Catpaw RSS job source changed; review the cancellation adapter.');
    source = source.replace(before, after);
  };
  source = `import { requestSignal } from ${JSON.stringify(importPath(file, 'src/backend/request-scope.ts'))};\n` + source;
  replace('  private createCancelledResult(request: RssWorkerRequest)', `  private cancelRequest(requestId: string) {
    const index = this.queue.findIndex(job => job.request.requestId === requestId);
    if (index >= 0) {
      const [job] = this.queue.splice(index, 1);
      if (job.request.feedId) this.queuedAutoBackfillFeedIds.delete(job.request.feedId);
      job.resolve(this.createCancelledResult(job.request)); this.changed(); return;
    }
    const current = this.current;
    if (current?.request.requestId !== requestId) return;
    if (this.cancelBeforeDispatch(this.createCancelledResult(current.request))) return;
    if (this.worker?.connected) {
      this.cancellationRequested.add(requestId);
      this.worker.send({ type: 'cancel', requestId }, error => { if (error && this.current === current) this.failWorker(error); });
    }
  }

  private createCancelledResult(request: RssWorkerRequest)`);
  replace('    const request: RssWorkerRequest = {', '    const signal = requestSignal(); signal?.throwIfAborted();\n    const request: RssWorkerRequest = {');
  replace('    return await new Promise<RssWorkerResult>((resolve, reject) => {',
    '    const abort = () => this.cancelRequest(request.requestId);\n    signal?.addEventListener("abort", abort, { once: true });\n    return await new Promise<RssWorkerResult>((resolve, reject) => {');
  replace('      });\n\n    });\n  }\n\n  private getPriority',
    '      });\n\n    }).finally(() => signal?.removeEventListener("abort", abort));\n  }\n\n  private getPriority');
  await writeFile(file, source);
}
