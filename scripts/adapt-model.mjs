import { readFile, writeFile } from 'node:fs/promises';
export async function adaptModel(importPath) {
  async function edit(file, replacements, imports) {
    let source = await readFile(file, 'utf8');
    for (const [before, after] of replacements) {
      if (source.split(before).length !== 2) throw new Error('Imported Catpaw model source changed; review the Harness adapter.');
      source = source.replace(before, after);
    }
    await writeFile(file, imports + source);
  }
  const store = '.generated/catpaw/electron/services/model-provider-store.ts';
  await edit(store, [
    ['list(): ModelProvider[] { return this.read().map(publicProvider); }', 'list(): ModelProvider[] { return [...harnessProvider(), ...this.read().map(publicProvider)]; }'],
    ['save(raw: SaveModelProviderInput): Promise<ModelProvider[]> {', 'save(raw: SaveModelProviderInput): Promise<ModelProvider[]> {\n    guardHarnessProvider(raw.id);'],
    ['remove(id: string): Promise<ModelProvider[]> {', 'remove(id: string): Promise<ModelProvider[]> {\n    guardHarnessProvider(id);'],
    ['    const supplied = normalizeModelApiKey(input.apiKey);', '    if (input.providerId === "harness") return undefined;\n    const supplied = normalizeModelApiKey(input.apiKey);'],
  ], `import { harnessProvider, guardHarnessProvider } from ${JSON.stringify(importPath(store, 'src/backend/harness-model.ts'))};\n`);
  const text = '.generated/catpaw/electron/services/model-text.ts';
  await edit(text, [['  const request = requestBody(target, system, content);',
    '  if (target.baseUrl === HARNESS_BASE_URL) return requestHarnessModel(target.model, system, content, signal);\n  const request = requestBody(target, system, content);']],
    `import { requestHarnessModel } from ${JSON.stringify(importPath(text, 'src/backend/harness-model.ts'))};\nimport { HARNESS_BASE_URL } from ${JSON.stringify(importPath(text, 'src/shared/model.ts'))};\n`);
  const handlers = '.generated/catpaw/electron/ipc/model-provider-handlers.ts';
  await edit(handlers, [['    discoverProviderModels(input, await modelProviderStore.discoveryKey(input))',
    '    input.providerId === "harness" ? harnessProvider().flatMap(provider => provider.models) : discoverProviderModels(input, await modelProviderStore.discoveryKey(input))']],
    `import { harnessProvider } from ${JSON.stringify(importPath(handlers, 'src/backend/harness-model.ts'))};\n`);
}
