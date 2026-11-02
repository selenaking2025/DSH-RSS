import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readJson } from './lib/catpaw-source.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  ref: { type: 'string', default: 'HEAD' }, check: { type: 'boolean', default: false },
} });
if (positionals.length > 1) throw new Error('用法：npm run update:catpaw -- [Catpaw目录] [--ref 提交或标签] [--check]');
await mkdir('output', { recursive: true });
const log = 'output/catpaw-update.log';
await writeFile(log, '');
const result = { status: 'running', stages: [], pluginVersion: null, artifact: null };
async function run(label, command, args) {
  console.log(`\n${label}…`);
  const child = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
  await appendFile(log, `\n${label}\n${output}`);
  process.stdout.write(output);
  result.stages.push({ name: label, passed: child.status === 0 });
  if (child.error || child.status !== 0) throw new Error(`${label}未通过，请查看 ${log}。`);
}
try {
  await run(values.check ? '检查本地 Catpaw 更新' : '同步本地 Catpaw 提交', process.execPath,
    ['scripts/sync-catpaw.mjs', resolve(positionals[0] ?? '../catpaw'), '--ref', values.ref, ...(values.check ? ['--check'] : [])]);
  result.pluginVersion = (await readJson('output/catpaw-sync.json')).pluginVersion;
  if (values.check) result.status = 'checked';
  else {
    await run('检查并同步运行依赖', 'npm', ['run', 'sync:catpaw:deps']);
    await run('验证来源、适配与功能', 'npm', ['run', 'check']);
    await run('生成插件候选安装包', 'npm', ['pack', '--pack-destination', 'output']);
    const pkg = await readJson('package.json');
    result.artifact = `output/${pkg.name}-${pkg.version}.tgz`;
    result.status = 'passed';
    console.log(`\n本地更新完成：${result.artifact}`);
  }
} catch (error) {
  result.status = 'failed';
  console.error(error.message);
  console.error('已同步的变更和报告保留，修复提示的适配后可重新运行；本次没有生成新的安装包。');
  process.exitCode = 1;
} finally {
  await writeFile('output/catpaw-update-result.json', `${JSON.stringify(result, null, 2)}\n`);
}
