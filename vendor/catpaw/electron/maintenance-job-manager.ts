import { ChildWorkerManager, type WorkerQueueJob } from './child-worker-manager';
import { validMaintenanceValue, type MaintenanceInputs, type MaintenanceOutputs, type MaintenanceKind,
  type MaintenanceRequest, type MaintenanceResult, type MaintenanceMessage, type MaintenanceStatus } from './contracts/maintenance';

type Job = WorkerQueueJob<MaintenanceRequest, MaintenanceResult>;
export class MaintenanceJobManager extends ChildWorkerManager<MaintenanceRequest, MaintenanceResult, Job, MaintenanceMessage, MaintenanceStatus> {
  private sequence = 0;
  getStatus() { return this.currentState; }
  protected getWorkerBaseName() { return 'maintenance-worker'; }
  protected getJobTimeoutMs() { return 30 * 60_000; }
  protected startJob(job: Job): MaintenanceStatus { return { kind: job.request.kind, phase: 'running', completed: 0, total: 0 }; }
  async run<K extends MaintenanceKind>(kind: K, input: MaintenanceInputs[K]): Promise<MaintenanceOutputs[K]> {
    const sequence = ++this.sequence;
    const result = await new Promise<MaintenanceResult>((resolve, reject) => this.enqueueJob({
      request: { requestId: `maintenance-${Date.now()}-${sequence}`, kind, input } as MaintenanceRequest,
      priority: 'interactive', sequence, enqueuedAt: Date.now(), resolve, reject,
    }));
    if (!result.ok) throw new Error(result.error);
    return result.value as MaintenanceOutputs[K];
  }
  protected handleWorkerPayload(message: Exclude<MaintenanceMessage, { type: 'ready' }>) {
    if (message.type === 'progress') {
      if (message.requestId !== this.getCurrentRequestId()) return;
      if (![message.completed, message.total].every((value) => Number.isSafeInteger(value) && value >= 0) || message.completed > message.total) {
        void this.failWorker(new Error('INVALID_MAINTENANCE_PROGRESS')); return;
      }
      if (this.currentState) this.currentState = { ...this.currentState, completed: message.completed, total: message.total };
      this.changed(); return;
    }
    const result = message.payload;
    if (!result || result.requestId !== this.getCurrentRequestId()) return;
    if (result.kind !== this.current?.request.kind || (result.ok ? !validMaintenanceValue(result.kind, result.value) : typeof result.error !== 'string')) {
      void this.failWorker(new Error('INVALID_MAINTENANCE_RESULT')); return;
    }
    this.resolveCurrent(result);
  }
}
export const maintenanceJobManager = new MaintenanceJobManager();
