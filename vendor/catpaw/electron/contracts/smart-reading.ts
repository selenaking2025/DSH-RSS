import type { EntryListItem } from './reader';

export const READING_RULE_VERSION = 1;
export type ReadingFocus = {
  id: string; revision: number; title: string; goal: string; prefer: string; avoid: string;
  feedIds: string[]; groupIds: string[]; priority: number; expiresAt: number | null;
  enabled: boolean; archived: boolean; ephemeral: boolean; updatedAt: number;
};
export type SaveReadingFocus = Omit<ReadingFocus, 'id' | 'revision' | 'updatedAt'> & { id?: string; revision?: number };
export type ReadingFeedback = 'useful' | 'irrelevant' | 'known';
export type ReadingSource = { title: string; text: string; sourceHash: string; sourceKind: 'content' | 'excerpt' };
export type ReadingAssessment = {
  relevance: number; specificity: number; applicability: number; confidence: number;
  excluded: number; evidence: string[]; sourceKind: 'content' | 'excerpt'; model: string;
  insufficient?: boolean; minutes?: number | null;
};
export type ReadingProgress = {
  kind: 'repeat' | 'update' | 'evidence' | 'perspective'; confidence: number;
  previousEntryId: string; previousTitle: string; previousHash: string;
  currentEvidence: string; previousEvidence: string;
};
export type ReadingItem = {
  entry: EntryListItem; focusId: string; focusTitle: string; score: number;
  assessment: ReadingAssessment; feedback: ReadingFeedback | null; minutes: number | null;
  relatedIds: string[]; progress: ReadingProgress | null;
};
export type ReadingWindow = { since: number; until: number; onlyUnread: boolean };
export type ReadingRunInput = Partial<ReadingWindow> & { focusId?: string };
export type ReadingStatus = {
  id: string; phase: 'running' | 'completed' | 'cancelled' | 'failed';
  completed: number; total: number; errors: number; message: string | null; updatedAt: number;
};
export type ReadingSnapshot = { items: ReadingItem[]; pending: number; uncertain: number; evaluated: number; total: number; version: number };
export type ReadingChange = { kind: 'status' | 'results' | 'settings' | 'focuses' };
export type ReadingQuery = ReadingWindow & { text: string; description: string; feedIds: string[]; groupIds: string[] };
export type ReadingResult<T> = { ok: true; data: T } | { ok: false; error: string };
export class ReadingError extends Error {}

export function todayReadingWindow(now = new Date()): ReadingWindow {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { since: start.getTime(), until: end.getTime(), onlyUnread: false };
}

export const READING_TEMPLATES = [
  { title: 'AI 产品实践', goal: '了解个人或小团队如何把 AI 能力做成用户愿意付费的产品。', prefer: '具体案例、用户问题、产品迭代、成本与结果', avoid: '只有口号的宣传稿和融资消息' },
  { title: '独立开发获客', goal: '找到小团队获得第一批付费用户的可借鉴做法。', prefer: '实际渠道、执行步骤、定价和转化数据', avoid: '缺少案例的泛泛建议' },
  { title: 'Agent 技术落地', goal: '了解 Agent 在实际项目中的可靠性、评估和工程实践。', prefer: '代码、实验结果、失败分析和部署经验', avoid: '没有验证的能力宣传' },
] as const;
