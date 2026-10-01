import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { harnessGenerator } from '../src/host/harness-model.ts';
import { startFixture } from './fixture-server.mjs';

async function until(check: () => Promise<boolean>, timeout = 25000) {
  const end = Date.now() + timeout;
  while (!await check()) { if (Date.now() > end) throw new Error('Advanced fixture timed out'); await new Promise(resolve => setTimeout(resolve, 100)); }
}
class FixtureAdapter extends LlmAdapter {
  calls = 0; aborted = 0; mode: 'ok' | 'slow' | 'truncated' = 'ok';
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++;
    if (this.mode === 'slow') {
      await new Promise<void>((_resolve, reject) => {
        const stop = () => { this.aborted++; reject(new Error('fixture cancelled')); };
        if (options.signal?.aborted) stop(); else options.signal?.addEventListener('abort', stop, { once: true });
      });
    }
    const message = options.messages[0];
    assert.ok('content' in message && Array.isArray(message.content));
    const input = JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join(''));
    const text = JSON.stringify(input.segments ? { translations: input.segments.map((text: string) => `译文：${text}`) }
      : { summary: '阅读器在宿主中提供文章管理，并将正文、摘要和译文保存在独立数据目录中。' });
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'finish', reason: { kind: this.mode === 'truncated' ? 'max-tokens' : 'stop' } };
  }
}
test('dynamic browser, Harness model, translation progress, cancellation and durable caches', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catpaw-advanced-'));
  const fixture = await startFixture(); fixture.state.dynamic = true;
  const ctx = new Context(); await ctx.plugin(LlmRuntime);
  const adapter = new FixtureAdapter(); ctx.llm.registerAdapter(['catpaw-fixture'], adapter);
  const { CatpawBackend } = await import(new URL('../dist/backend.js', import.meta.url).href);
  const backend = new CatpawBackend(directory, { disableScheduler: true,
    harnessModel: { model: 'fixture-text', generate: harnessGenerator(ctx, 'catpaw-fixture', 'fixture-text') } });
  const call = (method: string, args: unknown[] = [], signal?: AbortSignal) => backend.call(method, args, 'advanced', signal);
  try {
    await backend.start();
    const providers = await call('listModelProviders');
    assert.equal(providers.data[0].id, 'harness'); assert.equal(providers.data[0].keyConfigured, true);
    assert.equal((await call('removeModelProvider', ['harness'])).ok, false);
    assert.equal((await call('addFeed', [{ url: `${fixture.origin}/rss` }])).ok, true);
    const [entry] = await call('listEntries', [{}]);
    assert.equal((await call('fetchEntryContent', [entry.id])).ok, true);
    assert.match((await call('getEntry', [entry.id])).contentText, /JavaScript rendered content/);
    const selection = { providerId: 'harness', model: 'fixture-text' };
    const summary = await call('analyzeEntry', [{ requestId: 'summary-test', entryId: entry.id, selection }]);
    assert.equal(summary.ok, true, JSON.stringify(summary));
    const count = adapter.calls;
    await call('analyzeEntry', [{ requestId: 'summary-cached', entryId: entry.id, selection }]);
    assert.equal(adapter.calls, count, 'summary must use its stored result');
    const input = { requestId: 'translation-test', entryId: entry.id, selection, targetLanguage: 'zh-CN', texts: ['Hello Harness.', 'Read saved articles.'] };
    const translated = await call('translateArticle', [input]);
    assert.deepEqual(translated.texts, input.texts.map(text => `译文：${text}`));
    const events = await backend.events('advanced', 0, new AbortController().signal);
    assert.ok(events.events.some((event: { channel: string }) => event.channel === 'rss:translationProgress'));
    const translatedCount = adapter.calls;
    await backend.restart();
    assert.equal((await call('getArticleSummary', [entry.id])).summary, summary.analysis.summary);
    assert.deepEqual((await call('translateArticle', [input])).texts, translated.texts);
    assert.equal(adapter.calls, translatedCount, 'restart must preserve completed caches');
    adapter.mode = 'truncated';
    assert.equal((await call('translateArticle', [{ ...input, requestId: 'incomplete', texts: ['uncached text'] }])).ok, false);
    adapter.mode = 'slow'; const controller = new AbortController();
    const before = adapter.calls;
    const cancelled = assert.rejects(call('translateArticle', [{ ...input, requestId: 'cancel-me', texts: ['cancel this'] }], controller.signal), /CANCELLED/);
    await until(async () => adapter.calls > before); controller.abort(); await cancelled;
    await until(async () => adapter.aborted === 1);
    const timedOut = assert.rejects(call('translateArticle', [{ ...input, requestId: 'deadline-test', texts: ['deadline text'] }], AbortSignal.timeout(150)), /CANCELLED|Timeout/);
    await timedOut; await until(async () => adapter.aborted === 2);
    adapter.mode = 'ok';
    assert.equal((await call('translateArticle', [{ ...input, requestId: 'retry-cancelled', texts: ['cancel this'] }])).ok, true);
    await assert.rejects(readFile(join(directory, 'model-providers.json')), /ENOENT/, 'Harness credentials must not be copied into Catpaw');
  } finally { await backend.close(); await ctx.fiber.dispose(); await fixture.close(); await rm(directory, { recursive: true, force: true }); }
});

test('smart reading uses its configured decision protocol, saves feedback and cancels safely', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catpaw-decisions-'));
  const fixture = await startFixture();
  let requests = 0, slow = false;
  const server = createServer(async (request, response) => {
    const buffers: Buffer[] = []; for await (const chunk of request) buffers.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(buffers).toString()); requests++;
    if (slow) return;
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, value]) => {
      const question = value as { type: string; criteria?: string[] | Record<string, string> };
      if (question.type === 'noul') return [id, { type: 'noul', noul: id === 'excluded' ? 0 : 1 }];
      const keys = Object.keys(question.criteria!); const choice = keys.at(-1)!;
      return [id, { type: question.type, ...(question.type === 'score' ? { score: Number(choice) } : { choice }), confidence: 1, probabilities: { [choice]: 1 } }];
    }));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 100, output_tokens: 10 } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const { CatpawBackend } = await import(new URL('../dist/backend.js', import.meta.url).href);
  const backend = new CatpawBackend(directory, { disableScheduler: true });
  const call = (method: string, args: unknown[] = []) => backend.call(method, args, 'decisions');
  try {
    await backend.start(); await call('addFeed', [{ url: `${fixture.origin}/rss` }]);
    const settings = { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'jev-1.13.0', enabled: true,
      autoFetch: false, groupEvents: false, trackProgress: false, dailyTokenLimit: 100000, apiKey: 'local-fixture-only' };
    assert.equal((await call('saveReadingSettings', [settings])).ok, true);
    assert.equal((await call('testReadingConnection')).ok, true);
    const result = await call('saveReadingFocus', [{ title: '阅读器集成', goal: '了解 RSS 阅读器如何接入 Harness', prefer: '工程实现', avoid: '',
      feedIds: [], groupIds: [], priority: 1, expiresAt: null, enabled: true, archived: false, ephemeral: false }]);
    assert.equal(result.ok, true); const focus = result.data;
    const window = { since: Date.now() - 86400000, until: Date.now() + 86400000, onlyUnread: false, focusId: focus.id };
    assert.equal((await call('startReadingRun', [window])).ok, true);
    await until(async () => (await call('getReadingStatus')).phase !== 'running');
    assert.equal((await call('getReadingStatus')).phase, 'completed');
    const snapshot = await call('getReadingResults', [window]);
    assert.equal(snapshot.ok, true); assert.equal(snapshot.data.evaluated, 2);
    assert.ok(snapshot.data.items.length > 0);
    const entryId = snapshot.data.items[0].entry.id;
    assert.equal((await call('saveReadingFeedback', [{ entryId, focusId: focus.id, value: 'useful' }])).ok, true);
    const calls = requests;
    await call('startReadingRun', [window]);
    await until(async () => (await call('getReadingStatus')).phase !== 'running');
    assert.equal(requests, calls, 'completed assessments must be cached');
    const { updatedAt: _updatedAt, ...editableFocus } = focus;
    await call('saveReadingFocus', [{ ...editableFocus, goal: '修改关注事项以重新筛选' }]);
    slow = true; await call('startReadingRun', [window]);
    await until(async () => requests > calls); await call('cancelReadingRun');
    assert.equal((await call('getReadingStatus')).phase, 'cancelled');
    const config = await readFile(join(directory, 'reading-decision.json'), 'utf8');
    assert.ok(!config.includes('local-fixture-only'), 'provider key must be encrypted on disk');
  } finally {
    await backend.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await fixture.close(); await rm(directory, { recursive: true, force: true });
  }
});
