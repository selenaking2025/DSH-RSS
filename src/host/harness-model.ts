import type { Context } from '@deepseek-ai/cordis';
import { BlockAssembler, type StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ModelGenerator } from '../shared/model.ts';

export function harnessGenerator(ctx: Context, provider: string, model: string): ModelGenerator {
  return async (request, signal) => {
    if (request.model !== model) throw new Error('Harness 模型选择已更改，请重新打开 Catpaw。');
    const assembler = new BlockAssembler();
    let size = 0, terminal: StreamChunk | undefined;
    for await (const chunk of ctx.llm.stream({ provider, model, system: request.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: request.content }] }], maxTokens: 8192, signal })) {
      signal.throwIfAborted();
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') size += chunk.text.length;
      if (size > 300000) throw new Error('Harness 模型返回内容过长。');
      if (chunk.type === 'finish') terminal = chunk;
      assembler.push(chunk);
    }
    signal.throwIfAborted();
    if (!terminal || assembler.finish.kind !== 'stop') throw new Error('Harness 模型没有完整完成请求，请重试或检查模型设置。');
    const blocks = assembler.blocks();
    if (blocks.some(block => block.type === 'tool-call')) throw new Error('阅读模型仅应返回文本。');
    const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('');
    if (!text.trim() || text.length > 120000) throw new Error('Harness 模型返回了空内容或过长内容。');
    return text;
  };
}
