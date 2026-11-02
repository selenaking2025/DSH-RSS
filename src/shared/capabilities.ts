/** These methods are implemented by installFileActions in the browser. */
export const BROWSER_METHODS = [
  'previewOpml', 'importOpml', 'exportOpml', 'backupDatabase', 'restoreDatabase', 'exportDiagnostics',
] as const;

export function missingBackendMethods(required: readonly string[], available: readonly string[]) {
  const browser = new Set<string>(BROWSER_METHODS), backend = new Set(available);
  return required.filter(method => !browser.has(method) && !backend.has(method));
}
