import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { readJson } from './catpaw-source.mjs';

async function packageFiles(directory) {
  const [pkg, lock] = await Promise.all([
    readJson(join(directory, 'package.json')), readJson(join(directory, 'package-lock.json')),
  ]);
  if (!lock.packages?.['']) throw new Error('插件 package-lock.json 缺少根包记录。');
  return { pkg, lock };
}

export async function planPluginVersion(source, ref, snapshotVersion, directory = '.') {
  // HEAD follows the local release version, including an uncommitted version bump.
  // A pinned historical ref must instead keep that commit's release version.
  const upstream = ref === 'HEAD'
    ? await readJson(join(source, 'package.json'))
    : { name: 'catpaw', version: snapshotVersion };
  const parsed = typeof upstream.version === 'string' ? semver.parse(upstream.version) : null;
  const canonical = parsed && `${parsed.version}${parsed.build.length ? `+${parsed.build.join('.')}` : ''}`;
  if (upstream.name !== 'catpaw' || !parsed || canonical !== upstream.version) {
    throw new Error('Catpaw package.json 必须包含 name: catpaw 和完整有效的版本号，例如 0.1.7。');
  }
  const { pkg, lock } = await packageFiles(directory);
  return {
    before: pkg.version, after: upstream.version,
    source: ref === 'HEAD' ? 'local-package' : 'git-ref',
    needsUpdate: [pkg.version, lock.version, lock.packages[''].version].some(version => version !== upstream.version),
  };
}

export async function applyPluginVersion(plan, directory = '.') {
  if (!plan.needsUpdate) return;
  const { pkg, lock } = await packageFiles(directory);
  pkg.version = lock.version = lock.packages[''].version = plan.after;
  await writeFile(join(directory, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  await writeFile(join(directory, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
}
