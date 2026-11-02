import { execFileSync } from 'node:child_process';
import { readJson } from './lib/catpaw-source.mjs';
import { dependencyPlan } from './lib/catpaw-dependencies.mjs';
const plan = dependencyPlan(await readJson('package.json'), await readJson('vendor/catpaw/package.json'), await readJson('catpaw.config.json'));
if (plan.problems.length) throw new Error(plan.problems.join('\n'));
if (!plan.changes.length) console.log('Catpaw 运行依赖已匹配。');
else {
  console.log('同步 Catpaw 运行依赖：', plan.changes.map(d => `${d.name}: ${d.current} → ${d.target}`).join('\n'));
  execFileSync('npm', ['install', '--save-exact', '--', ...plan.changes.map(d => `${d.name}@${d.target}`)], { stdio: 'inherit' });
}
