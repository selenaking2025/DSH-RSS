import { readJson, verifySnapshot } from './lib/catpaw-source.mjs';
import { dependencyPlan } from './lib/catpaw-dependencies.mjs';

export async function checkCatpaw() {
  const source = await verifySnapshot('vendor/catpaw');
  if (source.sourceMode !== 'git-archive' || source.sourceChanges.length) throw new Error('发布快照必须来自已提交 Git 源码。');
  const [policy, reviewed, upstream, plugin, lock] = await Promise.all([
    readJson('catpaw.config.json'), readJson('catpaw-adapter-lock.json'), readJson('vendor/catpaw/package.json'),
    readJson('package.json'), readJson('package-lock.json'),
  ]);
  if (source.version !== upstream.version) throw new Error('Catpaw 来源版本与快照不符。');
  const unreviewed = policy.reviewSources.filter(file => !source.files[file] || reviewed.files[file] !== source.files[file]);
  if (unreviewed.length) throw new Error(`以下上游适配边界已变化，须检查代码及回归用例后更新 catpaw-adapter-lock.json：\n${unreviewed.join('\n')}`);
  const plan = dependencyPlan(plugin, upstream, policy);
  if (plan.problems.length || plan.changes.length) throw new Error([...plan.problems,
    ...plan.changes.map(d => `${d.name}: ${d.current} 不匹配 ${d.target}；请运行 npm run sync:catpaw:deps。`)].join('\n'));
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (JSON.stringify(plugin[section]) !== JSON.stringify(lock.packages[''][section])) throw new Error(`${section} 与 package-lock.json 不一致；请运行 npm install。`);
  }
  if (plugin.version !== lock.packages[''].version || plugin.version !== lock.version) throw new Error('插件版本与 package-lock.json 不一致。');
  console.log(`Catpaw 来源、文件完整性、适配记录和依赖检查通过：${source.version} / ${source.revision.slice(0, 12)}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) await checkCatpaw();
