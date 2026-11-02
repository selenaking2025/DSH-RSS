import semver from 'semver';

export function dependencyPlan(plugin, upstream, policy) {
  const changes = [], problems = [];
  const classified = new Set([...policy.dependencies, ...policy.hostDependencies, ...Object.keys(policy.excludedDependencies)]);
  for (const name of Object.keys(upstream.dependencies)) {
    if (!classified.has(name)) problems.push(`新增上游依赖 ${name} 尚未分类；请检查 catpaw.config.json。`);
  }
  for (const name of policy.dependencies) {
    const target = upstream.dependencies[name];
    if (!target) { problems.push(`上游已删除依赖 ${name}，请检查是否仍需保留。`); continue; }
    const current = plugin.dependencies?.[name];
    if (!semver.valid(current) || !semver.satisfies(current, target)) changes.push({ name, current: current ?? null, target });
  }
  const electron = upstream.devDependencies?.electron;
  if (!semver.valid(electron)) problems.push('上游 Electron 须固定为明确版本。');
  else if (plugin.dependencies?.electron !== electron) changes.push({ name: 'electron', current: plugin.dependencies?.electron ?? null, target: electron });
  for (const name of policy.hostDependencies) {
    const version = plugin.devDependencies?.[name], range = upstream.dependencies[name];
    if (!range || !semver.valid(version) || !semver.satisfies(version, range)) problems.push(`${name} 的宿主兼容版本 ${version} 不满足 Catpaw ${range}，需要单独验证 Harness。`);
  }
  return { changes, problems };
}
