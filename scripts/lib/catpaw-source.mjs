import { mkdtemp, readFile, readdir, writeFile, rm, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { bridgeContract, contractChanges } from './catpaw-contract.mjs';

export const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const git = (source, args, options = {}) => execFileSync('git', ['-C', source, ...args], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options,
});

export async function hashes(directory) {
  const result = {};
  async function scan(dir, prefix = '') {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = prefix + entry.name, file = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`源码中不允许符号链接：${name}`);
      if (entry.isDirectory()) await scan(file, `${name}/`);
      else if (name !== 'SOURCE.json') result[name] = createHash('sha256').update(await readFile(file)).digest('hex');
    }
  }
  await scan(directory);
  return result;
}

export async function verifySnapshot(directory) {
  const manifest = await readJson(join(directory, 'SOURCE.json'));
  const actual = await hashes(directory);
  const changed = [...new Set([...Object.keys(manifest.files), ...Object.keys(actual)])]
    .filter(file => actual[file] !== manifest.files[file]);
  if (changed.length) throw new Error(`Catpaw 快照被修改或不完整：${changed.join(', ')}。请把适配改动放到 src 或 scripts 中。`);
  return manifest;
}

/** Read an immutable Git tree. Local edits and untracked files never enter the snapshot. */
export async function exportSource(source, ref = 'HEAD', parent = tmpdir()) {
  source = resolve(source);
  const revision = git(source, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error('无法确定 Catpaw 提交号。');
  const selected = ['electron', 'renderer/src', 'package.json', 'THIRD_PARTY_NOTICES.txt'];
  const entries = git(source, ['ls-tree', '-r', '-z', revision, '--', ...selected]).split('\0').filter(Boolean);
  for (const entry of entries) {
    const [meta, file] = entry.split('\t');
    if (!/^100(644|755) blob /.test(meta) || !file || file.split('/').includes('..')) throw new Error(`不支持的上游文件：${entry}`);
  }
  const directory = await mkdtemp(join(parent, '.catpaw-import-'));
  try {
    const archive = git(source, ['archive', '--format=tar', revision, '--', ...selected], { encoding: 'buffer' });
    execFileSync('tar', ['-xf', '-', '-C', directory], { input: archive });
    async function exclude(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name);
        if (['tests', 'node_modules', '.DS_Store'].includes(entry.name)) await rm(file, { recursive: true, force: true });
        else if (entry.isDirectory()) await exclude(file);
      }
    }
    await exclude(directory);
    const pkg = await readJson(join(directory, 'package.json'));
    if (pkg.name !== 'catpaw' || typeof pkg.version !== 'string') throw new Error('来源不是有效的 Catpaw 项目。');
    const files = await hashes(directory);
    for (const required of ['electron/contracts/rss.ts', 'electron/main.ts', 'renderer/src/App.tsx', 'THIRD_PARTY_NOTICES.txt']) {
      if (!files[required]) throw new Error(`上游缺少必需文件：${required}`);
    }
    const manifest = { project: 'Catpaw', version: pkg.version, revision, sourceMode: 'git-archive', sourceChanges: [], files };
    await writeFile(join(directory, 'SOURCE.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return { directory, manifest, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }); throw error;
  }
}

export async function compareSources(before, after, policy) {
  const [oldMeta, newMeta, oldPkg, newPkg] = await Promise.all([
    readJson(join(before, 'SOURCE.json')), readJson(join(after, 'SOURCE.json')),
    readJson(join(before, 'package.json')), readJson(join(after, 'package.json')),
  ]);
  const added = Object.keys(newMeta.files).filter(file => !(file in oldMeta.files));
  const removed = Object.keys(oldMeta.files).filter(file => !(file in newMeta.files));
  const changed = Object.keys(newMeta.files).filter(file => file in oldMeta.files && newMeta.files[file] !== oldMeta.files[file]);
  const contract = async root => bridgeContract(await readFile(join(root, 'electron/contracts/rss.ts'), 'utf8'));
  const dependencies = [];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of new Set([...Object.keys(oldPkg[section] ?? {}), ...Object.keys(newPkg[section] ?? {})])) {
      if (oldPkg[section]?.[name] !== newPkg[section]?.[name]) dependencies.push({ name, section, before: oldPkg[section]?.[name] ?? null, after: newPkg[section]?.[name] ?? null });
    }
  }
  return { before: { version: oldPkg.version, revision: oldMeta.revision }, after: { version: newPkg.version, revision: newMeta.revision },
    needsUpdate: oldMeta.revision !== newMeta.revision || added.length + removed.length + changed.length > 0,
    files: { added, removed, changed }, interfaces: contractChanges(await contract(before), await contract(after)), dependencies,
    reviewRequired: [...added, ...removed, ...changed].filter(file => policy.reviewSources.includes(file)) };
}

export function reportMarkdown(report) {
  const list = values => values.length ? values.map(value => `- ${value}`).join('\n') : '- 无';
  return `# Catpaw 同步报告\n\n来源：${report.before.version} (${report.before.revision}) → ${report.after.version} (${report.after.revision})\n\n` +
    (report.pluginVersion ? `插件版本：${report.pluginVersion.before} → ${report.pluginVersion.after}（${report.pluginVersion.source === 'local-package' ? '本地 Catpaw package.json' : '指定 Git 提交'}）\n\n` : '') +
    `文件：新增 ${report.files.added.length}，修改 ${report.files.changed.length}，删除 ${report.files.removed.length}。\n\n` +
    `## 需要检查的适配边界\n\n${list(report.reviewRequired)}\n\n` +
    `## 接口变化\n\n${list(Object.entries(report.interfaces).flatMap(([kind, names]) => names.map(name => `${kind}: ${name}`)))}\n\n` +
    `## 依赖变化\n\n${list(report.dependencies.map(d => `${d.name} (${d.section}): ${d.before ?? '无'} → ${d.after ?? '删除'}`))}\n\n` +
    `## 文件变化\n\n${list(Object.entries(report.files).flatMap(([kind, files]) => files.map(file => `${kind}: ${file}`)))}\n`;
}

/** Keep the previous snapshot until a complete staged import can replace it. */
export async function replaceSnapshot(staged, destination) {
  const previous = await mkdtemp(join(dirname(destination), '.catpaw-previous-'));
  await rm(previous, { recursive: true });
  await rename(destination, previous);
  try { await rename(staged, destination); }
  catch (error) { await rename(previous, destination); throw error; }
  await rm(previous, { recursive: true, force: true });
}
