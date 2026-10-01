import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import z from '@deepseek-ai/schemastery';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { CatpawBackend } from './backend.ts';
import { registerReadTools } from './tools.ts';
import { registerWriteTools, registerDeleteTools } from './write-tools.ts';
import { harnessGenerator } from './harness-model.ts';
import { isRecord, errorMessage } from '../shared/protocol.ts';

export interface Config { dataDir?: string; electronPath?: string; allowAgentWrites?: boolean; disableScheduler?: boolean; harnessProvider?: string; harnessModel?: string }
export const name = 'catpaw';
export const inject = ['tools', 'connection', 'webServer', 'llm'];
export const Config: z<Config> = z.object({
  dataDir: z.string().description('Catpaw 插件的独立数据目录。'),
  electronPath: z.string().description('可选：Electron 可执行文件路径。'),
  allowAgentWrites: z.boolean().default(false).description('允许 AI 修改订阅与阅读状态。'),
  disableScheduler: z.boolean().default(false).description('关闭此插件的定时刷新。'),
  harnessProvider: z.string().description('可选：使用 Harness 已配置的模型提供方 ID，须同时指定模型。'),
  harnessModel: z.string().description('可选：Harness 中的模型 ID。密钥仍由 Harness 管理。'),
});

export async function apply(ctx: Context, config: Config) {
  const defaultRoot = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const dataDir = resolve(config.dataDir ?? join(defaultRoot, 'data', 'catpaw'));
  if (Boolean(config.harnessProvider) !== Boolean(config.harnessModel)) throw new Error('harnessProvider 和 harnessModel 必须同时填写。');
  const backend = new CatpawBackend(dataDir, { electronPath: config.electronPath, disableScheduler: config.disableScheduler,
    ...(config.harnessModel ? { harnessModel: { model: config.harnessModel, generate: harnessGenerator(ctx, config.harnessProvider!, config.harnessModel) } } : {}) });
  ctx.effect(() => () => backend.close(), 'catpaw: backend lifetime');
  registerReadTools(ctx, backend);
  if (config.allowAgentWrites) {
    registerWriteTools(ctx, backend);
    ctx.inject(['approval', 'tools'], inner => registerDeleteTools(inner, backend));
  }
  const handle = async (method: string, payload: unknown, signal: AbortSignal) => {
    try {
      if (!isRecord(payload) || typeof payload.owner !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(payload.owner)) throw new Error('INVALID_CATPAW_CLIENT');
      if (method === 'events') {
        if (!Number.isSafeInteger(payload.after) || (payload.after as number) < 0) throw new Error('INVALID_CATPAW_CURSOR');
        return { ok: true, value: await backend.events(payload.owner, payload.after as number, signal) };
      }
      if (method === 'release') { backend.release(payload.owner); return { ok: true, value: null }; }
      if (!Array.isArray(payload.args)) throw new Error('INVALID_CATPAW_ARGUMENTS');
      const value = await backend.call(method, payload.args, payload.owner, signal);
      if (method === 'commitRestore' && isRecord(value) && value.restartRequired === true) await backend.restart();
      return { ok: true, value };
    } catch (error) { return { ok: false, error: { code: 'catpaw/request', message: errorMessage(error), details: {} } }; }
  };
  ctx.connection.fetch.register({
    path: '/api/catpaw/invoke', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      try {
        const envelope: unknown = await request.json();
        if (!isRecord(envelope) || envelope.type !== 'client-request' || envelope.method !== 'catpaw/invoke'
          || typeof envelope.rpcId !== 'string' || envelope.rpcId.length > 128 || !isRecord(envelope.payload)
          || typeof envelope.payload.method !== 'string') return new Response('Invalid Catpaw envelope', { status: 400 });
        const result = await handle(envelope.payload.method, envelope.payload, request.signal);
        return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result });
      } catch (error) { return new Response(errorMessage(error), { status: 400 }); }
    },
  });
  // Publish the route before the client can race the Electron startup. Each call
  // already waits for the same backend readiness promise.
  try { await backend.start(); } catch (error) { await backend.close(); throw error; }
}
