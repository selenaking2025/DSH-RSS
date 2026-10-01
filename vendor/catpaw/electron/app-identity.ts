import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CATPAW_PACKAGE_NAME = 'catpaw';
export const CATPAW_PRODUCT_NAME = 'Catpaw';
export const CATPAW_APP_ID = 'ai.catpaw.reader';
export const CATPAW_USER_DATA_DIR_NAME = 'catpaw-rss-reader';
export const CATPAW_DATABASE_FILE_NAME = 'catpaw.sqlite3';
export const CATPAW_USER_DATA_ENV_KEY = 'CATPAW_USER_DATA_DIR';
export const CATPAW_SQLITE_BUSY_TIMEOUT_ENV_KEY = 'CATPAW_SQLITE_BUSY_TIMEOUT_MS';
const LEGACY_SNOWPAW_DATABASE_FILE_NAME = 'snowpaw.sqlite3';
const LEGACY_USER_DATA_DIR_NAMES = ['snowpaw', 'Snowpaw', 'Electron'] as const;

type PathResolutionInput = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
};

type ElectronAppIdentityTarget = {
  setAppUserModelId: (id: string) => void;
  setName: (name: string) => void;
  setPath: (name: 'userData', targetPath: string) => void;
};

function expandHomePath(input: string, homeDir: string) {
  if (input === '~') {
    return homeDir;
  }
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(homeDir, input.slice(2));
  }
  return input;
}

export function resolvePlatformAppDataDir(input: PathResolutionInput = {}) {
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? os.homedir();
  const platform = input.platform ?? process.platform;

  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support');
  }

  if (platform === 'win32') {
    return env.APPDATA?.trim()
      || path.join(homeDir, 'AppData', 'Roaming');
  }

  return env.XDG_DATA_HOME?.trim()
    || path.join(homeDir, '.local', 'share');
}

export function resolveDefaultUserDataDir(input: PathResolutionInput = {}) {
  return path.join(resolvePlatformAppDataDir(input), CATPAW_USER_DATA_DIR_NAME);
}

function normalizedPathKey(targetPath: string, platform: NodeJS.Platform) {
  const resolvedPath = path.resolve(targetPath);
  return platform === 'linux' ? resolvedPath : resolvedPath.toLowerCase();
}

export function assertIsolatedUserDataDir(
  userDataDir: string,
  input: PathResolutionInput = {},
) {
  const platform = input.platform ?? process.platform;
  const resolvedDir = path.resolve(userDataDir);
  const resolvedKey = normalizedPathKey(resolvedDir, platform);
  const appDataDir = resolvePlatformAppDataDir(input);
  const reservedKeys = LEGACY_USER_DATA_DIR_NAMES.map((dirName) => (
    normalizedPathKey(path.join(appDataDir, dirName), platform)
  ));

  if (
    reservedKeys.includes(resolvedKey)
    || fs.existsSync(path.join(resolvedDir, LEGACY_SNOWPAW_DATABASE_FILE_NAME))
  ) {
    throw new Error(
      `${CATPAW_USER_DATA_ENV_KEY} must not point to a Snowpaw or legacy Electron data directory: ${resolvedDir}`,
    );
  }

  return resolvedDir;
}

export function resolveConfiguredUserDataDir(input: PathResolutionInput = {}) {
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? os.homedir();
  const configuredDir = env[CATPAW_USER_DATA_ENV_KEY]?.trim();
  if (configuredDir) {
    return assertIsolatedUserDataDir(
      path.resolve(expandHomePath(configuredDir, homeDir)),
      input,
    );
  }
  return assertIsolatedUserDataDir(resolveDefaultUserDataDir(input), input);
}

export function configureElectronAppIdentity(
  electronApp: ElectronAppIdentityTarget,
  input: PathResolutionInput = {},
) {
  const env = input.env ?? process.env;
  const userDataDir = resolveConfiguredUserDataDir({
    ...input,
    env,
  });

  fs.mkdirSync(userDataDir, { recursive: true });
  electronApp.setName(CATPAW_PRODUCT_NAME);
  electronApp.setAppUserModelId(CATPAW_APP_ID);
  electronApp.setPath('userData', userDataDir);
  env[CATPAW_USER_DATA_ENV_KEY] = userDataDir;

  return {
    appId: CATPAW_APP_ID,
    productName: CATPAW_PRODUCT_NAME,
    userDataDir,
  };
}
