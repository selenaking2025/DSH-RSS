import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureUserDataDir } from '../runtime';
import { localProviderSecrets } from './local-provider-secrets';
import { ModelProviderError, normalizeModelApiKey, normalizeModelBaseUrl, normalizeModelProvider,
  type DiscoverProviderModelsInput, type ModelProvider, type SaveModelProviderInput } from '../contracts/model-providers';

type StoredProvider = Omit<ModelProvider, 'keyConfigured' | 'keyNeedsReentry'> & { encryptedApiKey: string | null };
export type ProviderSecretStorage = { encrypt(value: string): Promise<Buffer>; decrypt(value: Buffer): Promise<string> };

const LOCAL_KEY_PREFIX = 'local:v1:';
const LEGACY_KEY_ERROR = '旧版密钥需要重新保存。请在 API Key 设置中重新输入此提供方的 API Key，无需系统密码。';

function publicProvider(provider: StoredProvider): ModelProvider {
  const { encryptedApiKey, ...metadata } = provider;
  const keyConfigured = encryptedApiKey?.startsWith(LOCAL_KEY_PREFIX) ?? false;
  return { ...metadata, keyConfigured, keyNeedsReentry: Boolean(encryptedApiKey) && !keyConfigured };
}

export class ModelProviderStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: () => string = ensureUserDataDir,
    private readonly secrets: ProviderSecretStorage = localProviderSecrets(directory)) {}

  private get file() { return path.join(this.directory(), 'model-providers.json'); }

  private read(): StoredProvider[] {
    try {
      if (!fs.existsSync(this.file)) return [];
      if (fs.statSync(this.file).size > 2 * 1024 * 1024) throw new Error();
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (![1, 2].includes(data.version) || !Array.isArray(data.providers) || data.providers.length > 64) throw new Error();
      const seen = new Set<string>();
      return data.providers.map((provider: StoredProvider) => {
        if (!provider || typeof provider !== 'object' || Object.keys(provider).some((key) => ![
          'id', 'kind', 'displayName', 'apiStyle', 'baseUrl', 'models', 'encryptedApiKey',
        ].includes(key))) throw new Error();
        const { apiKey: _key, editingId: _editingId, ...metadata } = normalizeModelProvider(provider);
        if (seen.has(metadata.id)) throw new Error();
        seen.add(metadata.id);
        if (provider.encryptedApiKey !== null && (typeof provider.encryptedApiKey !== 'string'
          || !provider.encryptedApiKey || provider.encryptedApiKey.length > 16384
          || !(data.version === 2 ? /^(?:local:v1:)?[A-Za-z0-9+/]+={0,2}$/ : /^[A-Za-z0-9+/]+={0,2}$/).test(provider.encryptedApiKey))) throw new Error();
        return { ...metadata, encryptedApiKey: provider.encryptedApiKey };
      });
    } catch {
      throw new ModelProviderError('模型配置读取失败，原有文件已保留。请检查应用数据目录后重试。');
    }
  }

  private write(providers: StoredProvider[]) {
    const file = this.file;
    const temporary = `${file}.${randomUUID()}.tmp`;
    const serialized = JSON.stringify({ version: 2, providers }, null, 2);
    if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw new ModelProviderError('模型配置过大，请减少提供方或模型数量后重试。');
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(temporary, serialized, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } catch {
      throw new ModelProviderError('保存模型配置失败，请检查磁盘空间和目录权限。原有配置已保留。');
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  list(): ModelProvider[] { return this.read().map(publicProvider); }

  save(raw: SaveModelProviderInput): Promise<ModelProvider[]> {
    return this.mutate(async () => {
      const input = normalizeModelProvider(raw);
      const providers = this.read();
      const previous = providers.find((provider) => provider.id === input.id);
      if (input.editingId !== undefined) {
        if (input.editingId !== input.id || !previous || previous.kind !== input.kind) throw new ModelProviderError('这个提供方已更改或移除，请重新打开后编辑。');
      } else if (previous) throw new ModelProviderError('这个提供方 ID 已存在，请编辑已有提供方或换一个 ID。');
      if (!previous && providers.length >= 64) throw new ModelProviderError('最多可以添加 64 个提供方。');
      if (previous?.encryptedApiKey && !input.apiKey
        && (previous.baseUrl !== input.baseUrl || previous.apiStyle !== input.apiStyle)) {
        throw new ModelProviderError('API 地址或协议已更改，请重新输入用于此服务的 API Key。');
      }
      if (previous?.encryptedApiKey && !previous.encryptedApiKey.startsWith(LOCAL_KEY_PREFIX) && !input.apiKey) {
        throw new ModelProviderError(LEGACY_KEY_ERROR);
      }
      if (input.kind === 'builtin' && !input.apiKey && !previous?.encryptedApiKey) throw new ModelProviderError('请输入 API Key。');
      const { apiKey, editingId: _editingId, ...metadata } = input;
      const encryptedApiKey = apiKey ? LOCAL_KEY_PREFIX + (await this.secrets.encrypt(apiKey)).toString('base64') : previous?.encryptedApiKey ?? null;
      const next = { ...metadata, encryptedApiKey };
      this.write(previous ? providers.map((provider) => provider.id === input.id ? next : provider) : [...providers, next]);
      return this.list();
    });
  }

  remove(id: string): Promise<ModelProvider[]> {
    return this.mutate(async () => {
      const providers = this.read();
      this.write(providers.filter((provider) => provider.id !== id));
      return this.list();
    });
  }

  async discoveryKey(input: DiscoverProviderModelsInput): Promise<string | undefined> {
    const supplied = normalizeModelApiKey(input.apiKey);
    if (supplied) return supplied;
    if (!input.providerId) return undefined;
    return this.mutate(async () => {
      const providers = this.read();
      const saved = providers.find((provider) => provider.id === input.providerId);
      if (!saved) throw new ModelProviderError('提供方已移除，请重新打开设置。');
      if (!saved.encryptedApiKey) return undefined;
      // Never send a retained credential to a changed endpoint or protocol.
      if (saved.baseUrl !== normalizeModelBaseUrl(input.baseUrl) || saved.apiStyle !== input.apiStyle) {
        throw new ModelProviderError('API 地址或协议已更改，请重新输入用于此服务的 API Key。');
      }
      // Reading old credentials must not trigger system authentication or change the saved file.
      if (!saved.encryptedApiKey.startsWith(LOCAL_KEY_PREFIX)) {
        throw new ModelProviderError(LEGACY_KEY_ERROR);
      }
      return this.secrets.decrypt(Buffer.from(saved.encryptedApiKey.slice(LOCAL_KEY_PREFIX.length), 'base64'));
    });
  }
}

export const modelProviderStore = new ModelProviderStore();
