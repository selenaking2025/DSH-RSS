import { cp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const source = resolve(process.argv[2] ?? '../catpaw');
const destination = resolve('vendor/catpaw');
await mkdir(destination, { recursive: true });
for (const dir of ['electron', 'renderer']) {
  await rm(join(destination, dir), { recursive: true, force: true });
  await cp(join(source, dir === 'renderer' ? 'renderer/src' : dir), join(destination, dir === 'renderer' ? 'renderer/src' : dir), {
    recursive: true, filter: file => !file.split('/').some(part => ['tests', 'node_modules', '.DS_Store'].includes(part)),
  });
}
for (const file of ['package.json', 'THIRD_PARTY_NOTICES.txt']) await cp(join(source, file), join(destination, file));
const hashes = {};
async function scan(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, file.name);
    if (file.isDirectory()) await scan(path);
    else if (file.name !== 'SOURCE.json') hashes[relative(destination, path)] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
}
await scan(destination);
await writeFile(join(destination, 'SOURCE.json'), JSON.stringify({
  project: 'Catpaw', revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(),
  sourceChanges: execFileSync('git', ['status', '--short'], { cwd: source, encoding: 'utf8' }).trim().split('\n'),
  files: hashes,
}, null, 2) + '\n');
console.log(`Imported ${Object.keys(hashes).length} Catpaw source files.`);
