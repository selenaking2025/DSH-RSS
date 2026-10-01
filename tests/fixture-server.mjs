import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/** Loopback-only deterministic sources for browser and integration checks. */
export async function startFixture(port = 0) {
  const state = { count: 2, failing: false, slow: false, dynamic: false, requests: 0 };
  let origin;
  const server = createServer((request, response) => {
    const url = new URL(request.url, origin);
    if (url.pathname === '/rss') {
      state.requests++;
      if (state.slow) return; // closeAllConnections in fixture cleanup cancels pending sockets.
      if (state.failing) { response.writeHead(503); response.end('Fixture unavailable'); return; }
      response.setHeader('Content-Type', 'application/rss+xml');
      response.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Catpaw 本地验收订阅</title><link>${origin}</link><description>隔离测试样本</description>${Array.from({ length: state.count }, (_, i) => `<item><title>Harness 阅读验证 ${i + 1}</title><guid>catpaw-fixture-${i + 1}</guid><link>${origin}/${state.dynamic ? 'dynamic' : 'article'}/${i + 1}</link><pubDate>${new Date(Date.now() - i * 60000).toUTCString()}</pubDate><description><![CDATA[<p>Catpaw 在 Harness 中保留完整的阅读体验。Portable reader fixture ${i + 1}.</p><p>这篇文章用于验证搜索、收藏、已读状态与 AI 正文读取。</p>]]></description></item>`).join('')}</channel></rss>`);
    } else if (url.pathname.startsWith('/dynamic/')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<html><head><title>动态内容验证</title></head><body><script>document.body.innerHTML='<article><h1>动态内容验证</h1>'+ '<p>JavaScript rendered content proves that the shared Electron browser completed this extraction. Catpaw 的动态网页抓取测试。</p>'.repeat(20) + '</article>';</script></body></html>`);
    } else if (url.pathname.startsWith('/article/')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<html><head><title>Harness 阅读验证</title></head><body><article><h1>Harness 阅读验证</h1>${'<p>Catpaw 完整正文提取的本地测试。Portable reader content extraction. </p>'.repeat(20)}</article></body></html>`);
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<html><head><link rel="alternate" type="application/rss+xml" title="Catpaw 本地验收订阅" href="${origin}/rss"></head><body>Catpaw local fixture</body></html>`);
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, state, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startFixture(19404);
  console.log(`Catpaw local RSS fixture: ${fixture.origin}/rss`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void fixture.close().then(() => process.exit(0)); });
}
