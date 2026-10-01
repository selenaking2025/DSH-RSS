import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-user-approval';
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools';
import { randomUUID } from 'node:crypto';
import type { CatpawBackend } from './backend.ts';
import { isRecord } from '../shared/protocol.ts';

const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] };
function operation(backend: CatpawBackend, exec: ToolExecution, method: string, args: unknown[]) {
  const owner = `agent:${randomUUID()}`;
  return backend.call(method, args, owner, exec.signal).then(value => JSON.stringify(value ?? null)).finally(() => backend.release(owner));
}
export function registerWriteTools(ctx: Context, backend: CatpawBackend) {
  ctx.tools.register(defineTool({ name: 'catpaw_set_read', description: '设置一篇 Catpaw 文章为已读或未读。只在用户允许 AI 修改阅读数据时提供。',
    parameters: { id: { type: 'string', required: true }, read: { type: 'boolean', required: true } }, output,
    execute: (args, exec) => operation(backend, exec, 'markRead', [args.id, args.read]),
  }));
  ctx.tools.register(defineTool({ name: 'catpaw_toggle_star', description: '切换一篇文章的收藏状态，返回切换后的 0 或 1。调用前先确认当前状态，避免重复切换。',
    parameters: { id: { type: 'string', required: true } }, output,
    execute: (args, exec) => operation(backend, exec, 'toggleStar', [args.id]),
  }));
  ctx.tools.register(defineTool({ name: 'catpaw_add_feed', description: '添加用户指定的 RSS 订阅并抓取文章；后台继续补全历史。',
    parameters: { url: { type: 'string', required: true }, title: { type: 'string' }, groupId: { type: 'string' } }, output,
    execute: (args, exec) => operation(backend, exec, 'addFeed', [args]),
  }));
  ctx.tools.register(defineTool({ name: 'catpaw_update_feed', description: '修改订阅名称、所属分组或启用状态。此工具不更换来源地址。',
    parameters: { id: { type: 'string', required: true }, title: { type: 'string' }, groupId: { type: 'string' }, enabled: { type: 'boolean' } }, output,
    execute: (args, exec) => operation(backend, exec, 'updateFeed', [args]),
  }));
  ctx.tools.register(defineTool({ name: 'catpaw_create_group', description: '创建 Catpaw 订阅分组，返回分组 ID。',
    parameters: { name: { type: 'string', required: true }, parentId: { type: 'string' } }, output,
    execute: (args, exec) => operation(backend, exec, 'createGroup', [args.name, args.parentId]),
  }));
  ctx.tools.register(defineTool({ name: 'catpaw_refresh', description: '刷新指定订阅或全部订阅。history=true 时补全历史；取消本次工具调用只取消本次抓取任务。',
    parameters: { feedId: { type: 'string' }, history: { type: 'boolean' } }, output, timeoutMs: 30 * 60_000,
    execute: (args, exec) => operation(backend, exec, args.history ? (args.feedId ? 'backfillFeed' : 'backfillAll') : (args.feedId ? 'refreshFeed' : 'refreshAll'), args.feedId ? [args.feedId] : []),
  }));
}

export function registerDeleteTools(ctx: Context, backend: CatpawBackend) {
  ctx.tools.register(defineTool({ name: 'catpaw_delete_feed', description: '删除订阅及其本地文章。必须通过 Harness 向当前用户发起一次确认；拒绝、取消或无法确认时不执行。',
    parameters: { id: { type: 'string', required: true } }, output,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('删除订阅需要带用户确认能力的 Harness 会话。');
      const feeds = await backend.call('listFeeds', [], 'agent', exec.signal);
      const feed = Array.isArray(feeds) ? feeds.find(row => isRecord(row) && row.id === args.id) : undefined;
      if (!isRecord(feed)) throw new Error('订阅不存在。');
      const outcome = await ctx.approval.request({ agent: exec.agent, toolName: 'catpaw_delete_feed', callId: exec.callId,
        reason: `删除 Catpaw 订阅「${String(feed.title)}」（${String(feed.url)}）及其本地文章？`, signal: exec.signal });
      if (outcome !== 'allowed-once') throw new Error(`未删除订阅：${outcome}`);
      exec.signal.throwIfAborted();
      return operation(backend, exec, 'deleteFeed', [args.id]);
    },
  }));
}
