import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureUserDataDir } from '../runtime';
import { localProviderSecrets } from './local-provider-secrets';
import { normalizeModelApiKey, normalizeModelBaseUrl } from '../contracts/model-providers';
import { DecisionError, JEV_BASE_URL, JEV_MODEL, type DecisionSettings, type DecisionTarget, type SaveDecisionSettings } from '../contracts/decision';

type Stored = Omit<DecisionSettings, 'keyConfigured'> & { encryptedApiKey: string | null };
const defaults: Stored = { baseUrl: JEV_BASE_URL, model: JEV_MODEL, enabled: false, autoFetch: false,
  groupEvents: true, trackProgress: true, dailyTokenLimit: 1_000_000, revision: 0, encryptedApiKey: null };

export function validateDecisionSettings(input: SaveDecisionSettings) {
  if (!input || typeof input !== 'object' || typeof input.model !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(input.model)
    || !['enabled', 'autoFetch', 'groupEvents', 'trackProgress'].every((key) => typeof input[key as keyof SaveDecisionSettings] === 'boolean')
    || !Number.isSafeInteger(input.dailyTokenLimit) || input.dailyTokenLimit < 10_000 || input.dailyTokenLimit > 100_000_000
    || (input.clearKey !== undefined && typeof input.clearKey !== 'boolean')) throw new DecisionError('请检查筛选模型、开关和每日用量上限。');
  if (['jev-latest', 'jev-preview'].includes(input.model)) throw new DecisionError('请选择明确的 Jev 版本号，以便保存的判断与模型版本一致。');
  return { baseUrl: normalizeModelBaseUrl(input.baseUrl), model: input.model, enabled: input.enabled,
    autoFetch: input.autoFetch, groupEvents: input.groupEvents, trackProgress: input.trackProgress,
    dailyTokenLimit: input.dailyTokenLimit };
}

export class DecisionSettingsStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private directory = ensureUserDataDir, private secrets = localProviderSecrets(directory),
    private environmentKey = () => process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY) {}
  private get file() { return path.join(this.directory(), 'reading-decision.json'); }
  private read(): Stored {
    try {
      if (!fs.existsSync(this.file)) return { ...defaults };
      if (fs.statSync(this.file).size > 32768) throw new Error();
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const settings = validateDecisionSettings(data);
      if (!Number.isSafeInteger(data.revision) || data.revision < 0 || (data.encryptedApiKey !== null
        && (typeof data.encryptedApiKey !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.encryptedApiKey)))) throw new Error();
      return { ...settings, revision: data.revision, encryptedApiKey: data.encryptedApiKey };
    } catch { throw new DecisionError('智能阅读配置读取失败，原有文件已保留。'); }
  }
  get(): DecisionSettings {
    const { encryptedApiKey, ...settings } = this.read();
    return { ...settings, keyConfigured: Boolean(encryptedApiKey || (settings.baseUrl === JEV_BASE_URL && this.environmentKey())) };
  }
  save(input: SaveDecisionSettings): Promise<DecisionSettings> {
    const save = async () => {
      const settings = validateDecisionSettings(input), previous = this.read();
      const apiKey = normalizeModelApiKey(input.apiKey);
      if (previous.baseUrl !== settings.baseUrl && previous.encryptedApiKey && !apiKey && !input.clearKey) {
        throw new DecisionError('服务地址已更改，请重新填写此服务的 API Key。');
      }
      const encryptedApiKey = input.clearKey ? null : apiKey
        ? (await this.secrets.encrypt(apiKey)).toString('base64') : previous.encryptedApiKey;
      if (settings.enabled && !encryptedApiKey && !(settings.baseUrl === JEV_BASE_URL && this.environmentKey())) {
        throw new DecisionError('请先配置 Jev API Key。', 'CONFIG_REQUIRED');
      }
      const next: Stored = { ...settings, encryptedApiKey, revision: previous.revision + 1 };
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        fs.mkdirSync(this.directory(), { recursive: true });
        fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, this.file);
      } catch { throw new DecisionError('智能阅读配置保存失败，请检查数据目录权限。'); }
      finally { fs.rmSync(temporary, { force: true }); }
      return this.get();
    };
    const result = this.pending.then(save); this.pending = result.catch(() => {}); return result;
  }
  async target(): Promise<DecisionTarget> {
    await this.pending;
    const settings = this.read();
    const apiKey = settings.encryptedApiKey
      ? await this.secrets.decrypt(Buffer.from(settings.encryptedApiKey, 'base64'))
      : settings.baseUrl === JEV_BASE_URL ? normalizeModelApiKey(this.environmentKey()) : undefined;
    if (!apiKey) throw new DecisionError('请在智能阅读设置中填写 Jev API Key。', 'CONFIG_REQUIRED');
    return { baseUrl: settings.baseUrl, model: settings.model, apiKey };
  }
}
export const decisionSettings = new DecisionSettingsStore();
