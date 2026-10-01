import { ipcMain } from './register';
import { ModelProviderError, type ModelProviderResult } from '../contracts/model-providers';
import { modelProviderStore } from '../services/model-provider-store';
import { discoverProviderModels } from '../services/model-discovery';

async function result<T>(operation: () => T | Promise<T>): Promise<ModelProviderResult<T>> {
  try { return { ok: true, data: await operation() }; }
  catch (error) {
    return { ok: false, error: error instanceof ModelProviderError ? error.message : '模型配置操作失败，请稍后重试。' };
  }
}

export function registerModelProviderHandlers() {
  ipcMain.handle('rss:listModelProviders', () => result(() => modelProviderStore.list()));
  ipcMain.handle('rss:saveModelProvider', (_event, input) => result(() => modelProviderStore.save(input)));
  ipcMain.handle('rss:removeModelProvider', (_event, id) => result(() => modelProviderStore.remove(id)));
  ipcMain.handle('rss:discoverProviderModels', (_event, input) => result(async () =>
    discoverProviderModels(input, await modelProviderStore.discoveryKey(input))));
}
