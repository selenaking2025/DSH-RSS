import type { RssBridge, RssInvokeMethod } from '../contracts/rss';
import { isThemePreference } from '../contracts/appearance';
type Rule = (value: unknown) => boolean;
const text: Rule = (v) => typeof v === 'string' && v.length > 0 && v.length <= 4096;
const id: Rule = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;
const bool: Rule = (v) => typeof v === 'boolean';
const integer = (max: number, min = 0): Rule => (v) => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const nullable = (rule: Rule): Rule => (v) => v === null || rule(v);
const optional = (rule: Rule): Rule => (v) => v === undefined || rule(v);
const array = (rule: Rule, max = 2000): Rule => (v) => Array.isArray(v) && v.length <= max && v.every(rule);
const object = (fields: Record<string, Rule>, required: string[] = []): Rule => (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const data = v as Record<string, unknown>;
  return required.every((key) => data[key] !== undefined)
    && Object.entries(data).every(([key, value]) => Object.prototype.hasOwnProperty.call(fields, key) && (value === undefined || fields[key](value)));
};
const filter = { feedId: nullable(id), feedIds: array(id), groupId: nullable(id), isRead: bool, isStarred: bool,
  onlyUnread: bool, onlyStarred: bool, mode: (v: unknown) => v === 'list' || v === 'full',
  createdAfter: nullable(integer(Number.MAX_SAFE_INTEGER)), createdBefore: nullable(integer(Number.MAX_SAFE_INTEGER)), sincePublishedAt: nullable(integer(Number.MAX_SAFE_INTEGER)), since: nullable(integer(Number.MAX_SAFE_INTEGER)), publishedAfter: integer(Number.MAX_SAFE_INTEGER),
  search: nullable((v: unknown) => typeof v === 'string' && v.length <= 1000),
  limit: nullable(integer(2000, 1)), offset: nullable(integer(10_000_000)),
  cursor: nullable(object({ sortAt: integer(Number.MAX_SAFE_INTEGER), createdAt: integer(Number.MAX_SAFE_INTEGER), id }, ['sortAt', 'createdAt', 'id'])) };
const batch = { since: nullable(integer(Number.MAX_SAFE_INTEGER)), maxPages: nullable(integer(10_000, 1)),
  maxPagesPerFeed: nullable(integer(10_000, 1)), feedIds: array(id), refreshConcurrency: nullable(integer(20, 1)), perHostConcurrency: nullable(integer(10, 1)) };
const query = { feedId: id, feedIds: array(id), runId: id, pipelineRunId: id, runType: nullable(text), status: nullable(text),
  providerType: text, providerClass: nullable(text), endpointStatus: text, limit: nullable(integer(2000, 1)), offset: nullable(integer(10_000_000)) };
const feed = { id, url: text, title: nullable((v: unknown) => typeof v === 'string' && v.length <= 1000),
  siteUrl: nullable(text), groupId: nullable(id), confirmUrlChange: bool, enabled: bool,
  fetchIntervalMinutes: nullable(integer(43_200, 1)) };

const modelId: Rule = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v);
const modelSelection = object({ providerId: modelId, model: id }, ['providerId', 'model']);
const apiKey: Rule = (v) => typeof v === 'string' && v.length <= 4096;
const apiStyle: Rule = (v) => ['openai-compat', 'anthropic', 'gemini'].includes(v as string);
const readingWindow = { focusId: id, since: integer(Number.MAX_SAFE_INTEGER), until: integer(Number.MAX_SAFE_INTEGER), onlyUnread: bool };
const shortText = (max: number): Rule => (v) => typeof v === 'string' && v.length <= max;
type ArgumentRules<Args extends unknown[]> = { [I in keyof Args]-?: Rule };
export const rssInputRules = {
  getReadingSettings: { args: [], changesState: false },
  saveReadingSettings: { args: [object({ baseUrl: text, model: id, enabled: bool, autoFetch: bool, groupEvents: bool,
    trackProgress: bool, dailyTokenLimit: integer(100_000_000, 10_000), apiKey, clearKey: bool },
    ['baseUrl', 'model', 'enabled', 'autoFetch', 'groupEvents', 'trackProgress', 'dailyTokenLimit'])], changesState: false },
  testReadingConnection: { args: [], changesState: false },
  listReadingFocuses: { args: [], changesState: false },
  saveReadingFocus: { args: [object({ id, revision: integer(Number.MAX_SAFE_INTEGER), title: shortText(80), goal: shortText(2000),
    prefer: shortText(1000), avoid: shortText(1000), feedIds: array(id, 500), groupIds: array(id, 100), priority: integer(3, 1),
    expiresAt: nullable(integer(Number.MAX_SAFE_INTEGER)), enabled: bool, archived: bool, ephemeral: bool },
    ['title', 'goal', 'prefer', 'avoid', 'feedIds', 'groupIds', 'priority', 'expiresAt', 'enabled', 'archived', 'ephemeral'])], changesState: false },
  getReadingStatus: { args: [], changesState: false },
  startReadingRun: { args: [object(readingWindow)], changesState: false },
  cancelReadingRun: { args: [], changesState: false },
  getReadingResults: { args: [object(readingWindow, ['focusId'])], changesState: false },
  saveReadingFeedback: { args: [object({ entryId: id, focusId: id, value: nullable((v) => ['useful', 'irrelevant', 'known'].includes(v as string)) },
    ['entryId', 'focusId', 'value'])], changesState: false },
  recordReadingVisit: { args: [id], changesState: false },
  splitReadingEvent: { args: [object({ leftId: id, rightId: id }, ['leftId', 'rightId'])], changesState: false },
  parseReadingQuery: { args: [text], changesState: false },
  getMaintenanceStatus: { args: [], changesState: false },
  getThemePreference: { args: [], changesState: false },
  setThemePreference: { args: [isThemePreference], changesState: false },
  listGroups: { args: [], changesState: false },
  listFeeds: { args: [], changesState: false },
  getUnreadCounts: { args: [], changesState: false },
  getSchedulerStatus: { args: [], changesState: false },
  getRefreshSettings: { args: [], changesState: false },
  cancelActiveJobs: { args: [], changesState: true },
  getEnrichmentQueueStatus: { args: [], changesState: false },
  openWeChatLogin: { args: [], changesState: true },
  exportOpml: { args: [], changesState: true },
  getAppStatus: { args: [], changesState: false },
  backupDatabase: { args: [], changesState: true },
  restoreDatabase: { args: [], changesState: true },
  exportDiagnostics: { args: [], changesState: true },
  getUpdateStatus: { args: [], changesState: false },
  checkForUpdates: { args: [], changesState: false },
  downloadUpdate: { args: [], changesState: false },
  installUpdate: { args: [], changesState: false },
  rebuildSearchIndex: { args: [], changesState: true },
  getEntry: { args: [id], changesState: false },
  toggleStar: { args: [id], changesState: true },
  fetchEntryContent: { args: [id], changesState: true },
  resolveXiaoyuzhouAudio: { args: [id], changesState: true },
  getSocialThread: { args: [id], changesState: false },
  analyzeEntry: { args: [object({ entryId: id, requestId: id, regenerate: bool, selection: modelSelection }, ['entryId', 'requestId'])], changesState: true },
  getArticleSummary: { args: [id], changesState: false },
  cancelArticleSummary: { args: [id], changesState: false },
  deleteGroup: { args: [id], changesState: true },
  refreshFeed: { args: [id], changesState: true },
  deleteFeed: { args: [id], changesState: true },
  resetSourceEndpointHealth: { args: [id], changesState: true },
  getXApiFallbackStatus: { args: [id], changesState: false },
  listEntries: { args: [optional(object(filter))], changesState: false },
  countEntries: { args: [optional(object(filter))], changesState: false },
  listPipelineRuns: { args: [optional(object(query))], changesState: false },
  listSourceEndpointHealth: { args: [optional(object(query))], changesState: false },
  listFeedRunDiagnostics: { args: [optional(object(query))], changesState: false },
  listFeedSyncStates: { args: [optional(object({ feedIds: nullable(array(id)) }))], changesState: false },
  listFeedEnrichmentStates: { args: [optional(object({ feedIds: nullable(array(id)) }))], changesState: false },
  refreshAll: { args: [optional(object(batch))], changesState: true },
  backfillAll: { args: [optional(object(batch))], changesState: true },
  previewOpml: { args: [optional(object({ groupId: nullable(id), token: nullable(id) }))], changesState: false },
  importOpml: { args: [optional(object({ groupId: nullable(id), token: nullable(id) }))], changesState: true },
  listModelProviders: { args: [], changesState: false },
  removeModelProvider: { args: [modelId], changesState: true },
  saveModelProvider: { args: [object({ id: modelId, editingId: modelId,
  kind: (v) => v === 'builtin' || v === 'custom', displayName: text, baseUrl: text, apiStyle, apiKey,
  models: array(id, 200) }, ['id', 'kind', 'displayName', 'baseUrl', 'apiStyle', 'models'])], changesState: true },
  discoverProviderModels: { args: [object({ providerId: modelId, baseUrl: text, apiStyle, apiKey }, ['baseUrl', 'apiStyle'])], changesState: false },
  translateArticle: { args: [object({ requestId: id, entryId: id, selection: modelSelection,
  targetLanguage: (v) => v === 'zh-CN' || v === 'en', texts: array(text, 2000),
}, ['requestId', 'entryId', 'targetLanguage', 'texts'])], changesState: false },
  cancelArticleTranslation: { args: [id], changesState: false },
  markRead: { args: [id, bool], changesState: true },
  markAllRead: { args: [optional(id)], changesState: true },
  backfillFeed: { args: [id, optional(object(batch))], changesState: true },
  discoverFeeds: { args: [text], changesState: false },
  addFeed: { args: [object(feed, ['url'])], changesState: true },
  updateFeed: { args: [object(feed, ['id'])], changesState: true },
  createGroup: { args: [text, optional(nullable(id))], changesState: true },
  updateGroup: { args: [object({ id, name: text, parentId: nullable(id) }, ['id'])], changesState: true },
  setXApiFallbackEnabled: { args: [object({ feedId: id, enabled: bool }, ['feedId', 'enabled'])], changesState: true },
  updateRefreshSettings: { args: [object({ enabled: bool, dailyTime: text, catchUpMissed: bool, historyStartYear: integer(2200, 1990), historyStartDate: nullable(text),
  historyMaxPagesPerFeed: integer(10_000, 1), historyDepth: text, historySince: nullable(integer(Number.MAX_SAFE_INTEGER)),
  historyYears: integer(100, 1) })], changesState: true },
} satisfies { [K in RssInvokeMethod]: { args: ArgumentRules<Parameters<RssBridge[K]>>; changesState: boolean } };

export function validateIpcInput(channel: string, args: unknown[]) {
  const name = channel.replace(/^rss:/, '');
  const schema: Rule[] | undefined = Object.prototype.hasOwnProperty.call(rssInputRules, name)
    ? rssInputRules[name as RssInvokeMethod].args : undefined;
  if (!schema || args.length > schema.length || !schema.every((rule, i) => rule(args[i]))) {
    throw new Error(`IPC_INVALID_INPUT:${channel}`);
  }
}
