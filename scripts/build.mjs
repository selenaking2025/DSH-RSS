import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { adaptRssJobs } from './adapt-jobs.mjs';
import { adaptModel } from './adapt-model.mjs';

const root = resolve('.');
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}
await rm('.generated', { recursive: true, force: true });
await cp('vendor/catpaw', '.generated/catpaw', { recursive: true });
await mkdir('dist/backend', { recursive: true });
await mkdir('output', { recursive: true });
function importPath(from, to) { const path = relative(dirname(resolve(from)), resolve(to)); return path.startsWith('.') ? path : `./${path}`; }
await adaptRssJobs(importPath);
await adaptModel(importPath);
for (const [file, target] of [['ipc/register.ts', 'src/backend/registry.ts'], ['desktop-window.ts', 'src/backend/windows.ts']]) {
  const destination = resolve('.generated/catpaw/electron', file);
  await writeFile(destination, `export * from ${JSON.stringify(importPath(destination, target))};\n`);
}
await writeFile('.generated/catpaw/electron/app-metadata.ts', 'export function getAppMetadata() { return { version: "0.1.0" }; }\n');
// The pinned source's structural DOM cast predates the installed DOM typings.
const discoveryPath = '.generated/catpaw/electron/providers/feed-discovery.ts';
await writeFile(discoveryPath, (await readFile(discoveryPath, 'utf8')).replace(
  /Array\.from\(dom\.window\.document\.querySelectorAll\('link\[rel\]\[href\]'\)\) as Array<\{[\s\S]*?\}>;/,
  "Array.from(dom.window.document.querySelectorAll<HTMLLinkElement>('link[rel][href]'));"));

const rendererFiles = await files('.generated/catpaw/renderer/src');
for (const file of rendererFiles.filter(file => /\.(tsx?|js)$/.test(file) && !file.endsWith('.d.ts'))) {
  let source = await readFile(file, 'utf8');
  const names = [];
  if (source.includes('window.catpaw')) { source = source.replaceAll('window.catpaw', 'readerBridge'); names.push('readerBridge'); }
  if (source.includes('document.')) { source = source.replaceAll('document.', 'readerDocument.'); names.push('readerDocument'); }
  // Original confirmation callers are async; keep the host connection responsive.
  if (source.includes('window.confirm(')) { source = source.replaceAll('window.confirm(', 'await readerConfirm('); names.push('readerConfirm'); }
  if (file.endsWith('/MaintenanceDialog.tsx')) source = source.replace('已准备恢复', '已恢复阅读数据');
  if (names.length) source = `import { ${names.join(', ')} } from ${JSON.stringify(importPath(resolve(file), 'src/client/environment.ts'))};\n${source}`;
  await writeFile(file, source);
}
const contract = await readFile('vendor/catpaw/electron/contracts/rss.ts', 'utf8');
const methods = [...contract.matchAll(/^  (\w+):/gm)].map(match => match[1]);
await writeFile('src/client/methods.ts', `// Generated from the imported RssBridge contract.\nexport const INVOKE_METHODS = ${JSON.stringify(methods.filter(name => !name.startsWith('on')), null, 2)} as const;\nexport const EVENT_METHODS = { onStateChanged: 'rss:stateChanged', onReadingChanged: 'rss:readingChanged', onTranslationProgress: 'rss:translationProgress', onUpdateStatusChanged: 'rss:updateStatusChanged' } as const;\n`);

let css = (await Promise.all(rendererFiles.filter(file => file.endsWith('.css')).map(file => readFile(file, 'utf8')))).join('\n');
css = css.replaceAll(':root', ':host').replace(/\bbody\s*\{/g, '.catpaw-body {').replaceAll('100vh', '100%');
css = css.replace(/@media \(prefers-color-scheme: dark\)\s*\{\s*:host\s*\{([\s\S]*?)\}\s*\}/, ':host([data-theme="dark"]) {$1}');
css = css.replaceAll('@media (min-width: 981px)', '@container catpaw (min-width: 761px)')
  .replaceAll('@media (max-width: 980px)', '@container catpaw (max-width: 760px)')
  .replaceAll('@media (max-width: 480px)', '@container catpaw (max-width: 480px)');
css += '\n:host{display:block;height:100%;min-height:0}#root,.app,.main{height:100%;min-height:0}.catpaw-body{position:relative;overflow:hidden}.rss-reader{height:100%;min-height:0}\n';
css += '\n:host{container-type:inline-size;container-name:catpaw}.main::before{display:none}.page-reader{padding-top:0}.detail-topline{flex-wrap:wrap;gap:8px}.detail-source{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n';
await writeFile('src/client/reader.css', css);
const backend = {
  index: 'src/backend/index.ts',
  'rss-worker': '.generated/catpaw/electron/rss-worker.ts',
  'reader-worker': '.generated/catpaw/electron/reader-worker.ts',
  'maintenance-worker': '.generated/catpaw/electron/maintenance-worker.ts',
};
await build({ entryPoints: backend, outdir: 'dist/backend', bundle: true, platform: 'node', format: 'cjs', target: 'node24',
  packages: 'external', sourcemap: true, tsconfig: 'tsconfig.json' });
await writeFile('dist/backend/package.json', '{"type":"commonjs"}\n');
await build({ entryPoints: { host: 'src/host/index.ts', backend: 'src/host/backend.ts' }, outdir: 'dist', bundle: true,
  platform: 'node', format: 'esm', target: 'node24', packages: 'external', sourcemap: true });
const client = await build({ entryPoints: ['src/client/index.tsx'], write: false, bundle: true, platform: 'browser', format: 'cjs',
  target: 'es2022', jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime'],
  define: { 'process.env.NODE_ENV': '"production"' }, minify: true,
  plugins: [{ name: 'reader-styles', setup(build) {
    build.onLoad({ filter: /\.css$/ }, async args => ({ contents: args.path === resolve('src/client/reader.css')
      ? `export default ${JSON.stringify(css)}` : 'export default ""', loader: 'js' }));
  } }],
});
await writeFile('dist/client.js', `window.__ModuleLoader__.load({id:"dsh-catpaw",factory(require){const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
console.log('Built Catpaw backend, workers, Harness host and browser plugin.');
