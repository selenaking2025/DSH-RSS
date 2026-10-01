import type { BrowserWindow, IpcMainInvokeEvent, Session } from 'electron';
import { shell } from 'electron';

export function isTrustedRendererUrl(candidate: string, expected: string) {
  try {
    const actual = new URL(candidate);
    const trusted = new URL(expected);
    actual.hash = '';
    trusted.hash = '';
    return actual.href === trusted.href;
  } catch { return false; }
}

export function externalLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function openExternalLink(raw: string) {
  const url = externalLink(raw);
  if (url) void shell.openExternal(url).catch((error) => console.warn('[navigation] external link failed', error.message));
}

export function validateSender(event: IpcMainInvokeEvent, window: BrowserWindow | null, rendererUrl: string) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents
    || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame
    || !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)) {
    throw new Error('IPC_UNTRUSTED_SENDER');
  }
}

export function secureReaderWindow(window: BrowserWindow, rendererUrl: string) {
  const contents = window.webContents;
  contents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url, rendererUrl)) return;
    event.preventDefault();
    openExternalLink(url);
  });
  contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame && !isTrustedRendererUrl(url, rendererUrl)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url);
    return { action: 'deny' };
  });
}

export function secureReaderSession(session: Session) {
  // Reading and playback do not require camera, microphone, location or file access.
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}
