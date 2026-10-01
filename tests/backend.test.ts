import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { CatpawBackend } from '../src/host/backend.ts';
import { parseCall } from '../src/shared/protocol.ts';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { registerReadTools } from '../src/host/tools.ts';

test('private protocol rejects invalid shapes and owner identities', () => {
  assert.throws(() => parseCall({ kind: 'call', id: '1', owner: '../bad', method: 'listFeeds', args: [] }));
  assert.throws(() => parseCall({ kind: 'call', id: '1', owner: 'test', method: '__proto__', args: [] }));
  assert.equal(parseCall({ kind: 'call', id: '1', owner: 'test', method: 'listFeeds', args: [] }).method, 'listFeeds');
});

test('isolated Catpaw reads source data, validates requests and releases its database lock', { timeout: 90000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-catpaw-test-'));
  const require = createRequire(import.meta.url);
  const previous = process.env.CATPAW_USER_DATA_DIR;
  process.env.CATPAW_USER_DATA_DIR = dataDir;
  const { closeDb } = require('../.generated/catpaw/electron/data/db-core.ts');
  const { upsertFeed } = require('../.generated/catpaw/electron/data/feed-write-repo.ts');
  const { upsertEntry } = require('../.generated/catpaw/electron/data/entry-repo.ts');
  upsertEntry({ feedId: upsertFeed({ url: 'https://example.invalid/rss', title: '测试订阅', groupId: null, sourceType: 'native-rss' }),
    title: 'Catpaw plugin article', guid: 'fixture-one', link: 'https://example.invalid/article', contentHtml: '<p>Portable reader search.</p>' });
  closeDb();
  if (previous === undefined) delete process.env.CATPAW_USER_DATA_DIR; else process.env.CATPAW_USER_DATA_DIR = previous;
  const { CatpawBackend: BuiltBackend } = await import(new URL('../dist/backend.js', import.meta.url).href);
  const backend: CatpawBackend = new BuiltBackend(dataDir, { disableScheduler: true });
  try {
    await backend.start();
    const entries = await backend.call('listEntries', [{ search: 'portable', limit: 20 }]) as { id: string; contentText: string }[];
    assert.equal(entries.length, 1); assert.equal(entries[0].contentText, 'Portable reader search.');
    assert.deepEqual(await backend.call('listEntries', [{ search: 'missing-term', limit: 20 }]), []);
    await assert.rejects(backend.call('getEntry', [123]), /IPC_INVALID_INPUT/);
    await assert.rejects(backend.call('notAMethod'), /UNKNOWN_CATPAW_METHOD/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(backend.call('listFeeds', [], 'test', controller.signal));
    const ctx = new Context();
    await ctx.plugin(SystemPrompt, {}); await ctx.plugin(ToolRuntime);
    const plugin = Object.assign((inner: Context) => registerReadTools(inner, backend), { inject: ['tools'] });
    const mounted = await ctx.plugin(plugin);
    const run = (name: string, args = {}) => ctx.tools.execute({ name, arguments: args,
      callId: ToolCallId('catpaw-test'), signal: new AbortController().signal });
    try {
      const search = await run('catpaw_search_articles', { query: 'portable' });
      assert.equal(search.isError, false);
      assert.match(JSON.stringify(search.content), /Catpaw plugin article/);
      const article = await run('catpaw_read_article', { id: entries[0].id, offset: 0, length: 8 });
      assert.match(JSON.stringify(article.content), /Portable/);
      assert.match(JSON.stringify(article.content), /example.invalid/);
      assert.equal((await run('catpaw_search_articles', { limit: 0 })).isError, true);
      assert.equal((await run('catpaw_read_article', { id: 3 })).isError, true);
      await mounted.dispose();
      assert.equal(ctx.tools.schemas().length, 0);
      await ctx.plugin(plugin);
      assert.equal(ctx.tools.schemas().length, 3);
    } finally { await ctx.fiber.dispose(); }
    await backend.close();
    const restarted = new BuiltBackend(dataDir, { disableScheduler: true });
    try {
      await restarted.start(); assert.equal((await restarted.call('listFeeds') as unknown[]).length, 1);
      const restarting = restarted.restart();
      const stopped = restarted.close();
      await Promise.allSettled([restarting, stopped]); await stopped;
      await assert.rejects(restarted.call('listFeeds'), /STOPPED/);
    }
    finally { await restarted.close(); }
  } finally { await backend.close(); await rm(dataDir, { recursive: true, force: true }); }
});
