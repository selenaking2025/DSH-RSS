import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Service } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { registerReadTools } from '../src/host/tools.ts';
import { registerWriteTools, registerDeleteTools } from '../src/host/write-tools.ts';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval';
import { startFixture } from './fixture-server.mjs';

async function until(check: () => Promise<boolean>, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for fixture state');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
test('RSS, tools, cancellation, OPML and backup restore share one isolated reader', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catpaw-workflow-'));
  const fixture = await startFixture();
  const { CatpawBackend } = await import(new URL('../dist/backend.js', import.meta.url).href);
  const backend = new CatpawBackend(directory, { disableScheduler: true });
  const ctx = new Context();
  const call = (method: string, args: unknown[] = []) => backend.call(method, args, 'workflow');
  try {
    await backend.start();
    const result = await call('addFeed', [{ url: `${fixture.origin}/rss` }]);
    assert.equal(result.ok, true, JSON.stringify(result));
    await until(async () => (await call('getSchedulerStatus')).queueDepth === 0);
    const [feed] = await call('listFeeds');
    assert.equal((await call('listEntries', [{}])).length, 2);
    assert.equal((await call('refreshFeed', [feed.id])).status, 'completed');
    assert.equal((await call('listEntries', [{}])).length, 2, 'refresh must deduplicate');
    fixture.state.count = 3;
    await call('refreshFeed', [feed.id]);
    const articles = await call('listEntries', [{}]); assert.equal(articles.length, 3);
    const article = articles[0];
    await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime);
    await ctx.plugin(Object.assign((inner: Context) => { registerReadTools(inner, backend); registerWriteTools(inner, backend); }, { inject: ['tools'] }));
    const tool = async (name: string, args: object) => {
      const result = await ctx.tools.execute({ name, arguments: args, callId: ToolCallId('reader-workflow'), signal: new AbortController().signal });
      assert.equal(result.isError, false, JSON.stringify(result.content)); return result;
    };
    await tool('catpaw_set_read', { id: article.id, read: true });
    assert.equal((await call('getEntry', [article.id])).isRead, 1);
    await tool('catpaw_toggle_star', { id: article.id });
    assert.equal((await call('listEntries', [{ onlyStarred: true }])).length, 1);
    assert.match(JSON.stringify((await tool('catpaw_search_articles', { query: 'Portable' })).content), /Harness 阅读验证/);
    const group = await call('createGroup', ['验证分组']);
    await call('updateFeed', [{ id: feed.id, title: '已编辑的订阅', groupId: group }]);
    await call('updateGroup', [{ id: group, name: '重命名分组' }]);
    assert.equal((await call('listFeeds'))[0].groupId, group);
    const opml = (await call('exportOpmlText')).xml;
    const preview = await call('stageOpml', [{ xml: opml }]);
    assert.equal(preview.existingFeedCount, 1);
    await call('importOpmlText', [{ xml: opml }]);
    assert.equal((await call('listFeeds')).length, 1);
    await assert.rejects(call('stageOpml', [{ xml: 12 }]), /INVALID_OPML/);
    // Cancellation of a queued request must not cancel a different client's running refresh.
    fixture.state.slow = true;
    const first = new AbortController(), second = new AbortController();
    const running = backend.call('refreshFeed', [feed.id], 'client-a', first.signal);
    const firstCancelled = assert.rejects(running, /CANCELLED/);
    await until(async () => Boolean((await call('getSchedulerStatus')).currentJob));
    const queued = backend.call('refreshFeed', [feed.id], 'client-b', second.signal);
    const secondCancelled = assert.rejects(queued, /CANCELLED/);
    await until(async () => (await call('getSchedulerStatus')).queueDepth >= 2);
    second.abort(); await secondCancelled;
    await until(async () => (await call('getSchedulerStatus')).queueDepth === 1);
    assert.ok((await call('getSchedulerStatus')).currentJob, 'first client must still be running');
    first.abort(); await firstCancelled;
    await until(async () => (await call('getSchedulerStatus')).queueDepth === 0);
    fixture.state.slow = false;
    assert.equal((await call('listEntries', [{}])).length, 3);
    fixture.state.failing = true;
    const unavailable = await call('refreshFeed', [feed.id]);
    assert.equal(unavailable.status, 'failed');
    assert.equal((await call('listEntries', [{}])).length, 3, 'source failure must retain saved articles');
    fixture.state.failing = false;
    const failed = await call('refreshFeed', ['nonexistent']);
    assert.equal(failed.status, 'failed');
    const backup = await call('backupData');
    const bytes = Buffer.from(backup.base64, 'base64');
    assert.equal(bytes.subarray(0, 16).toString(), 'SQLite format 3\0');
    await call('deleteFeed', [feed.id]); assert.equal((await call('listFeeds')).length, 0);
    const upload = await call('beginRestore', [bytes.length]);
    await assert.rejects(backend.call('appendRestore', [upload.id, 0, bytes.toString('base64')], 'wrong-owner'), /EXPIRED/);
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024) await call('appendRestore', [upload.id, offset, bytes.subarray(offset, offset + 512 * 1024).toString('base64')]);
    const summary = await call('validateRestore', [upload.id]); assert.equal(summary.entries, 3);
    assert.equal((await call('commitRestore', [upload.id])).restartRequired, true);
    await backend.restart();
    assert.equal((await call('listFeeds')).length, 1);
    assert.equal((await call('listEntries', [{}])).length, 3);
    assert.equal((await call('getEntry', [article.id])).isRead, 1);
    assert.ok((await readdir(join(directory, 'backups'))).some(file => file.startsWith('before-restore-')));
    await call('deleteGroup', [group]);
    assert.ok(!(await call('listGroups')).some((row: { id: string }) => row.id === group));
    let decision: ApprovalOutcome = 'unavailable';
    class ApprovalFixture extends Service {
      constructor(inner: Context) { super(inner, 'approval'); }
      async request() { return decision; }
    }
    await ctx.plugin(ApprovalFixture);
    await ctx.plugin(Object.assign((inner: Context) => registerDeleteTools(inner, backend), { inject: ['tools', 'approval'] }));
    const deletion = (agent?: Agent) => ctx.tools.execute({ name: 'catpaw_delete_feed', arguments: { id: feed.id },
      callId: ToolCallId('deletion-check'), signal: new AbortController().signal, ...(agent ? { agent } : {}) });
    assert.equal((await deletion()).isError, true, 'unattended deletion must be refused');
    const agent = { id: 'approval-fixture' } as Agent;
    for (decision of ['unavailable', 'cancelled', 'rejected'] as ApprovalOutcome[]) {
      assert.equal((await deletion(agent)).isError, true);
      assert.equal((await call('listFeeds')).length, 1);
    }
    decision = 'allowed-once'; assert.equal((await deletion(agent)).isError, false);
    assert.equal((await call('listFeeds')).length, 0);
  } finally {
    await ctx.fiber.dispose(); await backend.close(); await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
