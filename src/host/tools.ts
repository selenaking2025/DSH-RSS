import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { isRecord } from '../shared/protocol.ts';
import type { CatpawBackend } from './backend.ts';

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error('INVALID_CATPAW_RESULT');
  return value;
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
const render = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

export function registerReadTools(ctx: Context, backend: CatpawBackend) {
  ctx.tools.register(defineTool({
    name: 'catpaw_list_feeds', description: '列出 Catpaw 的 RSS 订阅，返回订阅 ID、名称、来源网址。', parameters: {},
    output: { schema: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string', required: true }, title: { type: 'string', required: true }, url: { type: 'string', required: true },
    } } }, render },
    async execute(_args, exec) {
      return records(await backend.call('listFeeds', [], 'agent', exec.signal)).map(row => ({ id: text(row.id), title: text(row.title), url: text(row.url) }));
    },
  }));
  ctx.tools.register(defineTool({
    name: 'catpaw_search_articles', description: '在已保存的 Catpaw 文章中按文字、订阅或未读状态查询。结果只包含摘要，正文用 catpaw_read_article 分页读取。',
    parameters: { query: { type: 'string' }, feedId: { type: 'string' }, unreadOnly: { type: 'boolean' },
      limit: { type: 'number' }, offset: { type: 'number' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', required: true }, title: { type: 'string', required: true }, url: { type: 'string', required: true },
        feedId: { type: 'string', required: true }, summary: { type: 'string', required: true },
      } } }, hasMore: { type: 'boolean', required: true },
    } }, render },
    async execute(args, exec) {
      const limit = args.limit ?? 20, offset = args.offset ?? 0;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('limit 须为 1–100，offset 须为非负整数。');
      const rows = records(await backend.call('listEntries', [{ search: args.query, feedId: args.feedId,
        onlyUnread: args.unreadOnly, limit: limit + 1, offset, mode: 'list' }], 'agent', exec.signal));
      return { items: rows.slice(0, limit).map(row => ({ id: text(row.id), title: text(row.title), url: text(row.link),
        feedId: text(row.feedId), summary: text(row.summary).slice(0, 1000) })), hasMore: rows.length > limit };
    },
  }));
  ctx.tools.register(defineTool({
    name: 'catpaw_read_article', description: '读取 Catpaw 本地文章正文，附原文网址。不会自动将文章标为已读；正文分页，抓取不足时明确返回摘要。',
    parameters: { id: { type: 'string', required: true }, offset: { type: 'number' }, length: { type: 'number' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string', required: true }, title: { type: 'string', required: true }, url: { type: 'string', required: true },
      content: { type: 'string', required: true }, totalCharacters: { type: 'number', required: true },
      nextOffset: { type: 'number', required: true }, excerptOnly: { type: 'boolean', required: true },
    } }, render },
    async execute(args, exec) {
      const offset = args.offset ?? 0, length = args.length ?? 12000;
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 50000) throw new Error('正文分页范围无效。');
      const row = await backend.call('getEntry', [args.id], 'agent', exec.signal);
      if (!isRecord(row)) throw new Error('文章不存在。');
      const full = text(row.contentText), content = full || text(row.summary);
      return { id: text(row.id), title: text(row.title), url: text(row.link), content: content.slice(offset, offset + length),
        totalCharacters: content.length, nextOffset: Math.min(offset + length, content.length), excerptOnly: !full };
    },
  }));
}
