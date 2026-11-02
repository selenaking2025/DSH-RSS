import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { exportSource, verifySnapshot, compareSources, replaceSnapshot, readJson, reportMarkdown } from './lib/catpaw-source.mjs';
import { planPluginVersion, applyPluginVersion } from './lib/catpaw-version.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  ref: { type: 'string', default: 'HEAD' }, check: { type: 'boolean', default: false },
  report: { type: 'string', default: 'output/catpaw-sync' },
} });
if (positionals.length > 1) throw new Error('用法：npm run sync:catpaw -- [Catpaw目录] [--ref 提交或标签] [--check]');
const source = resolve(positionals[0] ?? '../catpaw');
const destination = resolve('vendor/catpaw');
await verifySnapshot(destination);
const policy = await readJson('catpaw.config.json');
const imported = await exportSource(source, values.ref, resolve('vendor'));
try {
  const report = await compareSources(destination, imported.directory, policy);
  const sourceNeedsUpdate = report.needsUpdate;
  report.pluginVersion = await planPluginVersion(source, values.ref, imported.manifest.version);
  report.needsUpdate ||= report.pluginVersion.needsUpdate;
  const prefix = resolve(values.report);
  await mkdir(dirname(prefix), { recursive: true });
  await writeFile(`${prefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${prefix}.md`, reportMarkdown(report));
  if (!values.check) {
    if (sourceNeedsUpdate) await replaceSnapshot(imported.directory, destination);
    await applyPluginVersion(report.pluginVersion);
  }
  console.log(`${values.check ? '检查' : '同步'} Catpaw ${report.after.version} (${report.after.revision.slice(0, 12)})：${report.needsUpdate ? '有更新' : '已是当前提交'}。`);
  console.log(`插件版本：${report.pluginVersion.before} → ${report.pluginVersion.after}（${report.pluginVersion.source === 'local-package' ? '跟随本地 Catpaw package.json' : '跟随指定提交'}）。`);
  console.log(`新增 ${report.files.added.length}，修改 ${report.files.changed.length}，删除 ${report.files.removed.length}；需检查 ${report.reviewRequired.length} 个适配边界。`);
  console.log(`报告：${prefix}.md\n功能源码只读取已提交内容；版本号按上述来源同步。`);
} finally { await imported.cleanup(); }
