import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, cp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { exportSource, verifySnapshot, compareSources, replaceSnapshot } from '../scripts/lib/catpaw-source.mjs';
import { bridgeContract, contractChanges } from '../scripts/lib/catpaw-contract.mjs';
import { dependencyPlan } from '../scripts/lib/catpaw-dependencies.mjs';

async function fixture(t, version = '1.0.0') {
  const root = await mkdtemp(join(tmpdir(), 'catpaw-sync-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']); git(['config', 'user.name', 'Sync fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  const put = async (name, contents) => { const file=join(root,name); await mkdir(join(file,'..'),{recursive:true});await writeFile(file,contents); };
  await put('package.json', JSON.stringify({ name: 'catpaw', version, dependencies: {} }));
  await put('THIRD_PARTY_NOTICES.txt', 'fixture');
  await put('electron/contracts/rss.ts', 'export type RssBridge = { list: () => Promise<string[]> };');
  await put('electron/main.ts', 'export {};'); await put('renderer/src/App.tsx', 'export default null;');
  await put('electron/obsolete.ts', 'export {};');
  await put('electron/tests/ignored.ts', 'not shipped');
  git(['add','.']); git(['commit','-m','fixture']);
  return { root, git, put };
}

test('committed import ignores local edits, preserves source, excludes tests and detects tampering', async t => {
  const f=await fixture(t), revision=f.git(['rev-parse','HEAD']);
  await f.put('package.json','{"name":"catpaw","version":"9.9.9"}');
  const imported=await exportSource(f.root); t.after(imported.cleanup);
  assert.equal(imported.manifest.revision,revision); assert.equal(imported.manifest.version,'1.0.0');
  assert.deepEqual(imported.manifest.sourceChanges,[]);
  assert.ok(!Object.keys(imported.manifest.files).some(name=>name.includes('/tests/')));
  assert.match(await readFile(join(f.root,'package.json'),'utf8'),/9.9.9/);
  await verifySnapshot(imported.directory);
  await writeFile(join(imported.directory,'electron/main.ts'),'changed');
  await assert.rejects(verifySnapshot(imported.directory),/被修改/);
});

test('diff reports added and removed files and changed interfaces; failed replacement preserves snapshot', async t => {
  const f=await fixture(t), before=await exportSource(f.root);t.after(before.cleanup);
  await f.put('electron/contracts/rss.ts','export type RssBridge = { list: (limit: number) => Promise<string[]>; fresh: () => void };');
  await f.put('electron/new.ts','export {};'); await rm(join(f.root,'electron/main.ts'));
  f.git(['add','.']); f.git(['commit','-m','invalid update']);
  await assert.rejects(exportSource(f.root),/必需文件/);
  await verifySnapshot(before.directory);
  await f.put('electron/main.ts','export const updated = true;');
  await rm(join(f.root,'electron/obsolete.ts'));
  await rm(join(f.root,'electron/new.ts'));await f.put('electron/added.ts','export {};');
  f.git(['add','.']); f.git(['commit','-m','valid update']);
  const after=await exportSource(f.root);t.after(after.cleanup);
  const report=await compareSources(before.directory,after.directory,{reviewSources:['electron/main.ts']});
  assert.deepEqual(report.interfaces.added,['fresh']);assert.deepEqual(report.interfaces.changed,['list']);
  assert.ok(report.files.added.includes('electron/added.ts'));assert.deepEqual(report.reviewRequired,['electron/main.ts']);
  assert.ok(report.files.removed.includes('electron/obsolete.ts'));
  await assert.rejects(replaceSnapshot(join(f.root,'missing'),before.directory));
  assert.equal((await verifySnapshot(before.directory)).version,'1.0.0');
  await replaceSnapshot(after.directory,before.directory);
  assert.equal((await verifySnapshot(before.directory)).revision,after.manifest.revision);
});

test('missing refs and symlinks never become importable snapshots', async t => {
  const f=await fixture(t);await assert.rejects(exportSource(f.root,'missing-ref'));
  await symlink('/tmp',join(f.root,'electron/unsafe'));f.git(['add','.']);f.git(['commit','-m','symlink']);
  await assert.rejects(exportSource(f.root),/不支持的上游文件/);
});

test('contract parser handles formatting and nested properties without inventing RPC methods', () => {
  const a=bridgeContract('export type RssBridge = {\nquery:\n (arg: { nested: string }) => Promise<void>;\nonChanged: (cb: () => void) => () => void; };');
  assert.deepEqual(Object.keys(a),['query','onChanged']);
  assert.deepEqual(contractChanges(a,{}).removed,['query','onChanged']);
});

test('dependency gate detects exact upgrades and unclassified dependencies without replacing host React', () => {
  const policy={dependencies:['dompurify','jsdom'],hostDependencies:['react'],excludedDependencies:{'electron-updater':'host updates'}};
  const plugin={dependencies:{dompurify:'3.4.15',jsdom:'24.1.3',electron:'44.2.0'},devDependencies:{react:'18.3.1'}};
  const upstream={dependencies:{dompurify:'3.4.17',jsdom:'^24.0.0',react:'^18.2.0','new-library':'1.0.0'},devDependencies:{electron:'44.9.3'}};
  const result=dependencyPlan(plugin,upstream,policy);
  assert.deepEqual(result.changes.map(d=>d.name),['dompurify','electron']);
  assert.match(result.problems.join(),/new-library/);
  upstream.dependencies.react='^19.0.0';assert.match(dependencyPlan(plugin,upstream,policy).problems.join(),/宿主兼容/);
});

async function pluginFixture(t, upstream) {
  const client = join(upstream.root, 'plugin'); await mkdir(client);
  const baseline = await exportSource(upstream.root, 'HEAD', client); t.after(baseline.cleanup);
  await mkdir(join(client, 'vendor')); await cp(baseline.directory, join(client, 'vendor/catpaw'), { recursive: true });
  await cp(new URL('../scripts', import.meta.url), join(client, 'scripts'), { recursive: true });
  await symlink(new URL('../node_modules', import.meta.url).pathname, join(client, 'node_modules'), 'dir');
  await writeFile(join(client, 'catpaw.config.json'), JSON.stringify({ reviewSources: [] }));
  const project = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const pkg = { name: 'catpaw-local-update-fixture', version: '0.1.0', private: true,
    files: ['package.json', 'dist'], scripts: { 'sync:catpaw:deps': 'node -e "process.exit(0)"',
      build: 'node fixture-build.mjs', check: 'npm run build', 'pack:plugin': project.scripts['pack:plugin'] } };
  const manifest = join(client, 'package.json'); await writeFile(manifest, JSON.stringify(pkg));
  await writeFile(join(client, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version,
    lockfileVersion: 3, packages: { '': { name: pkg.name, version: pkg.version } } }));
  await writeFile(join(client, 'fixture-build.mjs'), `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
writeFileSync('dist/version.json', JSON.stringify({ version: JSON.parse(readFileSync('package.json')).version }));
`);
  const read = async file => JSON.parse(await readFile(join(client, file)));
  const invoke = extra => spawnSync(process.execPath, ['scripts/update-catpaw.mjs', upstream.root, ...extra], { cwd: client, encoding: 'utf8' });
  const pack = extra => spawnSync('npm', ['run', 'pack:plugin', '--', upstream.root, ...extra], { cwd: client, encoding: 'utf8' });
  async function assertVersion(version) {
    const lock = await read('package-lock.json');
    assert.deepEqual([(await read('package.json')).version, lock.version, lock.packages[''].version], [version, version, version]);
  }
  async function assertArtifact(version) {
    const result = await read('output/catpaw-update-result.json');
    assert.equal(result.status, 'passed');
    assert.equal(result.artifact, `output/${pkg.name}-${version}.tgz`);
    const artifact = join(client, result.artifact);
    assert.ok((await stat(artifact)).size > 0);
    for (const path of ['package/package.json', 'package/dist/version.json']) {
      const contents = JSON.parse(execFileSync('tar', ['-xOf', artifact, path], { encoding: 'utf8' }));
      assert.equal(contents.version, version);
    }
    await assertVersion(version);
  }
  return { client, baseline, manifest, read, invoke, pack, assertVersion, assertArtifact };
}

test('local update previews version without mutation, stops before packaging on failure, and retries at the Catpaw version', { timeout: 60_000 }, async t => {
  const upstream = await fixture(t, '0.1.3');
  const f = await pluginFixture(t, upstream);
  const pkg = await f.read('package.json'); pkg.scripts.check = 'node -e "process.exit(1)"';
  await writeFile(f.manifest, JSON.stringify(pkg));
  await upstream.put('package.json', '{"name":"catpaw","version":"0.1.6"}');
  await upstream.put('electron/added.ts', 'export {};');
  upstream.git(['add', 'electron/added.ts']); upstream.git(['commit', '-m', 'next source']);
  const checked = f.invoke(['--check']); assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.equal((await f.read('vendor/catpaw/SOURCE.json')).revision, f.baseline.manifest.revision);
  await f.assertVersion('0.1.0');
  assert.deepEqual((await f.read('output/catpaw-update-result.json')).pluginVersion,
    { before: '0.1.0', after: '0.1.6', source: 'local-package', needsUpdate: true });
  const failed = f.invoke([]); assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  await f.assertVersion('0.1.6');
  assert.equal((await f.read('output/catpaw-update-result.json')).artifact, null);
  await assert.rejects(stat(join(f.client, 'output/catpaw-local-update-fixture-0.1.6.tgz')), { code: 'ENOENT' });
  const current = await f.read('package.json'); current.scripts.check = 'npm run build';
  await writeFile(f.manifest, JSON.stringify(current));
  const passed = f.invoke([]); assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  await f.assertArtifact('0.1.6');
});

test('pack command follows local Catpaw 0.1.6 to 0.1.7 even without a new commit, and source-only updates keep that version', { timeout: 60_000 }, async t => {
  const upstream = await fixture(t, '0.1.3'), f = await pluginFixture(t, upstream);
  const sourceBefore = await readFile(join(f.client, 'vendor/catpaw/SOURCE.json'), 'utf8');
  await upstream.put('package.json', '{"name":"catpaw","version":"0.1.6"}');
  const first = f.pack([]); assert.equal(first.status, 0, first.stdout + first.stderr);
  await f.assertArtifact('0.1.6');
  await upstream.put('package.json', '{"name":"catpaw","version":"0.1.7"}');
  const checked = f.invoke(['--check']); assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  await f.assertVersion('0.1.6');
  const report = await f.read('output/catpaw-sync.json');
  assert.equal(report.before.revision, report.after.revision);
  assert.equal(report.needsUpdate, true); assert.equal(report.pluginVersion.after, '0.1.7');
  const next = f.pack([]); assert.equal(next.status, 0, next.stdout + next.stderr);
  await f.assertArtifact('0.1.7');
  assert.equal(await readFile(join(f.client, 'vendor/catpaw/SOURCE.json'), 'utf8'), sourceBefore);
  await upstream.put('electron/added.ts', 'export {};');
  upstream.git(['add', 'electron/added.ts']); upstream.git(['commit', '-m', 'same version source update']);
  const updated = f.invoke([]); assert.equal(updated.status, 0, updated.stdout + updated.stderr);
  await f.assertArtifact('0.1.7');
  assert.equal((await f.read('vendor/catpaw/SOURCE.json')).revision, upstream.git(['rev-parse', 'HEAD']));
  assert.equal(JSON.parse(await readFile(join(upstream.root, 'package.json'))).version, '0.1.7');
});

test('pinned refs use the committed version instead of the current working version', { timeout: 60_000 }, async t => {
  const upstream = await fixture(t, '0.1.3'), f = await pluginFixture(t, upstream);
  await upstream.put('package.json', '{"name":"catpaw","version":"0.1.7"}');
  const passed = f.pack(['--ref', f.baseline.manifest.revision]);
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  await f.assertArtifact('0.1.3');
  assert.equal((await f.read('output/catpaw-update-result.json')).pluginVersion.source, 'git-ref');
});

test('invalid Catpaw versions stop before changing source or package versions', async t => {
  const upstream = await fixture(t), f = await pluginFixture(t, upstream);
  await upstream.put('electron/added.ts', 'export {};');
  upstream.git(['add', 'electron/added.ts']); upstream.git(['commit', '-m', 'next source']);
  await upstream.put('package.json', '{"name":"catpaw","version":"^0.1.7"}');
  const failed = f.invoke([]); assert.equal(failed.status, 1);
  assert.match(failed.stdout + failed.stderr, /完整有效的版本号/);
  await f.assertVersion('0.1.0');
  assert.equal((await f.read('vendor/catpaw/SOURCE.json')).revision, f.baseline.manifest.revision);
  assert.equal((await f.read('output/catpaw-update-result.json')).artifact, null);
});
