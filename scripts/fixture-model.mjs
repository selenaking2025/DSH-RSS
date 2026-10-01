// Local deterministic OpenAI-compatible endpoint for UI acceptance; never shipped or enabled in production.
import { createServer } from 'node:http';
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/v1/models') { response.end(JSON.stringify({ data: [{ id: 'fixture-text' }] })); return; }
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') { response.writeHead(404); response.end('{}'); return; }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 1000000) throw new Error('Input too large'); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const input = JSON.parse(body.messages.find(message => message.role === 'user').content);
    const value = input.segments ? { translations: input.segments.map(text => `【本地翻译测试】${text}`) }
      : { summary: '本地验收样本：阅读器可以从宿主页面调用模型接口，并保存摘要与译文。这段文字用于验证界面、请求和缓存流程，不是真实模型生成的内容。' };
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }] }));
  } catch { response.writeHead(400); response.end('{}'); }
});
server.listen(19405, '127.0.0.1', () => console.log('UI fixture model (test only): http://127.0.0.1:19405/v1'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
