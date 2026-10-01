import path from 'node:path';
export function getAppMetadata(): { version: string; catpawRelease?: { downloadUrl?: string } } {
  return require(path.join(__dirname, __filename.endsWith('.ts') ? '../package.json' : '../../package.json'));
}
