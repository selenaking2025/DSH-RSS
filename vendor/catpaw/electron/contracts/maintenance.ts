export type OpmlPreviewSummary = {
  newGroupCount: number; reusedGroupCount: number; newFeedCount: number;
  existingFeedCount: number; duplicateFeedCount: number; invalidFeedCount: number;
};
type BackupSummary = { version: number; feeds: number; entries: number };
type OpmlInput = { xml: string; rootGroupId?: string | null };
export type MaintenanceInputs = {
  rebuild: undefined;
  preview: OpmlInput;
  import: OpmlInput;
  backup: { path: string };
  validate: { path: string };
  restore: { path: string; mode?: 'normal' | 'unreadable' };
  applyRestore: undefined;
};
export type MaintenanceOutputs = {
  rebuild: { ok: boolean; entries: number };
  preview: OpmlPreviewSummary;
  import: OpmlPreviewSummary & { groupCount: number; feedCount: number; feedIds: string[] };
  backup: BackupSummary & { ok: true; filePath: string };
  validate: BackupSummary;
  restore: BackupSummary & { ok: true; rollback: string };
  applyRestore: boolean;
};
export type MaintenanceKind = keyof MaintenanceInputs;
export type MaintenanceRequest = { [K in MaintenanceKind]: {
  requestId: string; kind: K; input: MaintenanceInputs[K];
} }[MaintenanceKind];
export type MaintenanceResult = { requestId: string; kind: MaintenanceKind } & (
  { ok: true; value: MaintenanceOutputs[MaintenanceKind] } | { ok: false; error: string }
);
export type MaintenanceStatus = {
  kind: MaintenanceKind; phase: 'waiting' | 'running'; completed: number; total: number;
};
export type MaintenanceMessage = { type: 'ready' } | { type: 'result'; payload: MaintenanceResult }
  | { type: 'progress'; requestId: string; completed: number; total: number };

export function validMaintenanceValue(kind: MaintenanceKind, value: unknown): boolean {
  if (kind === 'applyRestore') return typeof value === 'boolean';
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const count = (key: string) => Number.isSafeInteger(v[key]) && (v[key] as number) >= 0;
  if (kind === 'rebuild') return v.ok === true && count('entries');
  if (kind === 'preview' || kind === 'import') {
    if (!['newGroupCount', 'reusedGroupCount', 'newFeedCount', 'existingFeedCount', 'duplicateFeedCount', 'invalidFeedCount'].every(count)) return false;
    return kind === 'preview' || (count('groupCount') && count('feedCount') && Array.isArray(v.feedIds) && v.feedIds.every((id) => typeof id === 'string' && id.length > 0));
  }
  return ['version', 'feeds', 'entries'].every(count) && (kind === 'validate' || (v.ok === true && typeof v[kind === 'backup' ? 'filePath' : 'rollback'] === 'string'));
}
