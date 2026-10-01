import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge, type Rpc } from '../src/client/bridge.ts';

test('client reloads after a startup transport failure and aborts its retry loop on disposal', { timeout: 10000 }, async () => {
  let polls = 0;
  let released = false;
  const rpc: Rpc = { async call(_channel, _endpoint, payload, signal) {
    const method = (payload as { method: string }).method;
    if (method === 'release') { released = true; return { ok: true, value: null }; }
    if (method !== 'events') return { ok: true, value: [] };
    if (++polls === 1) throw new Error('HTTP 404');
    if (polls === 2) return { ok: true, value: { sequence: 0, events: [], connected: true } };
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new Error('aborted'));
      signal!.addEventListener('abort', abort, { once: true });
      if (signal!.aborted) abort();
    });
  } };
  const bridge = createBridge(rpc);
  try {
    await new Promise<void>(resolve => queueMicrotask(resolve));
    let status = '';
    bridge.onStatus(value => { status = value; });
    assert.match(status, /HTTP 404/);
    await new Promise<void>(resolve => bridge.onReconnect(resolve));
    assert.equal(status, '');
    assert.deepEqual(await bridge.rss.listFeeds(), []);
  } finally { bridge.dispose(); }
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(released, true);
  assert.equal(polls, 3);
});
