import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ModelProviderError } from '../contracts/model-providers';

/** App-owned storage: credentials never access the OS keychain, including old configurations. */
export function localProviderSecrets(directory: () => string) {
  const keyFile = () => path.join(directory(), 'model-providers.key');
  const readKey = () => {
    const key = fs.readFileSync(keyFile());
    if (key.length !== 32) throw new Error('Invalid local key');
    return key;
  };
  return {
    async encrypt(value: string): Promise<Buffer> {
      try {
        fs.mkdirSync(directory(), { recursive: true });
        if (!fs.existsSync(keyFile())) {
          try { fs.writeFileSync(keyFile(), randomBytes(32), { mode: 0o600, flag: 'wx' }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', readKey(), iv);
        const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
      } catch { throw new ModelProviderError('本地密钥保存失败，请检查应用数据目录权限。原有配置已保留。'); }
    },
    async decrypt(value: Buffer): Promise<string> {
      try {
        const decipher = createDecipheriv('aes-256-gcm', readKey(), value.subarray(0, 12));
        decipher.setAuthTag(value.subarray(12, 28));
        return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
      } catch { throw new ModelProviderError('无法读取本地保存的 API Key，请恢复完整的模型配置或重新输入密钥。'); }
    },
  };
}
