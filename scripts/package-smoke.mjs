import { spawnSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = resolve('.');
const bin = resolve('node_modules/@deepseek-ai/dsh/lib/bin.js');
const home = resolve('.dev/package-harness');
const profile = 'package-check';
const env = { ...process.env, DSH_HOME: home, PATH: `${resolve('node_modules/.bin')}:${process.env.PATH}` };
function run(args) {
  const result = spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' });
  if (result.status) { console.error(result.stdout, result.stderr); throw new Error('Isolated package installation failed'); }
  return result.stdout;
}
await mkdir(home, { recursive: true });
const directory = join(home, 'profiles', profile);
if (!existsSync(join(directory, 'package.json'))) run(['--profile', profile, '--from-default-profile', 'web', '--dump-config']);
// These exact native dependencies belong to this isolated test profile only.
const policy = join(directory, 'pnpm-workspace.yaml');
const prior = await readFile(policy, 'utf8').catch(() => '');
if (!prior.includes('allowBuilds:')) await writeFile(policy, `${prior}\nallowBuilds:\n  electron: true\n  better-sqlite3: true\n`);
// pnpm may reuse a file: tarball by path when its version is unchanged. Give
// every artifact a content-addressed path so repeated smoke runs test new code.
const tarball = resolve('output/dsh-catpaw-0.1.0.tgz');
const digest = createHash('sha256').update(await readFile(tarball)).digest('hex');
const archive = resolve('.dev/packages', `dsh-catpaw-${digest.slice(0, 16)}.tgz`);
await mkdir(resolve('.dev/packages'), { recursive: true });
await copyFile(tarball, archive);
console.log('Installing tarball into the isolated Harness profile…');
console.log(run(['plugin', '--profile', profile, 'add', archive]));
const installed = JSON.parse(await readFile(join(directory, 'node_modules/dsh-catpaw/package.json'), 'utf8'));
if (installed.version !== '0.1.0') throw new Error('Unexpected installed version');
for (const file of ['dist/host.js', 'dist/client.js', 'dist/backend/index.js']) {
  if (!(await readFile(file)).equals(await readFile(join(directory, 'node_modules/dsh-catpaw', file)))) {
    throw new Error(`Installed artifact is stale: ${file}`);
  }
}
const patch = join(home, 'package-check.patch.yml');
await writeFile(patch, `- id: catpaw\n  config:\n    dataDir: ${JSON.stringify(join(home, 'reader-data'))}\n    disableScheduler: true\n`);
console.log('Starting the installed package in Harness on port 19394…');
const child = spawn(process.execPath, [bin, '--profile', profile, '--patch', patch, '--no-open', '--port', '19394'], { env, stdio: 'inherit' });
process.on('SIGINT', () => child.kill('SIGINT')); process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', code => process.exit(code ?? 0));
