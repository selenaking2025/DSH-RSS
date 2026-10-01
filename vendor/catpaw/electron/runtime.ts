import fs from 'node:fs';
import path from 'node:path';
import {
  CATPAW_DATABASE_FILE_NAME,
  resolveConfiguredUserDataDir,
  resolveDefaultUserDataDir,
} from './app-identity';

export function resolvePlatformDefaultUserDataDir() {
  return resolveDefaultUserDataDir();
}

export function resolveUserDataDir() {
  return resolveConfiguredUserDataDir();
}

export function ensureUserDataDir() {
  const dir = resolveUserDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getDbPath() {
  return path.join(ensureUserDataDir(), CATPAW_DATABASE_FILE_NAME);
}

export function getPlaywrightProfileDir() {
  return path.join(ensureUserDataDir(), 'playwright-profile');
}

export function getWeChatProfileDir() {
  return path.join(ensureUserDataDir(), 'wechat-profile');
}
