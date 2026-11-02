import { recordMetric } from '../diagnostics/performance';
import { BrowserWindow, session } from 'electron';
import type { ChildProcess } from 'node:child_process';
import type { BrowserRequest, BrowserResult } from './protocol';
import { RequestScheduler } from '../network/request-scheduler';
import { acquireNetworkSlot } from '../network/request-slots';
import { isLinuxDoFeedUrl, linuxDoNavigationAllowed } from '../sources/linuxdo';
import { linuxDoFetchScript } from './linuxdo-page';
import { linuxDoNetwork } from './linuxdo-network';

let loginWindow: BrowserWindow | null = null;
const active = new Map<string, AbortController>();
const browserSlots = new RequestScheduler(3);
const pageControllers = new Set<AbortController>();
let closed = false;
let linuxDoAdmission: ReturnType<typeof linuxDoNetwork> | undefined;
let linuxDoLogin: { window: BrowserWindow; done: Promise<BrowserResult> } | null = null;

function createBrowserWindow(visible: boolean, scope: 'public' | 'wechat' | 'linuxdo') {
  // Keep existing WeChat authorization. Public pages never enter that partition.
  const browsingSession = session.fromPartition(scope === 'linuxdo' ? 'persist:catpaw-linuxdo'
    : scope === 'wechat' ? 'persist:catpaw-source-browser' : 'catpaw-public-browser');
  if (scope === 'linuxdo') linuxDoAdmission ??= linuxDoNetwork(browsingSession);
  browsingSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browsingSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({
    width: 1100, height: 800, show: visible, title: visible
      ? scope === 'linuxdo' ? 'Catpaw · Linux DO 验证（完成后关闭窗口）' : 'Catpaw · 微信登录' : 'Catpaw · 内容读取',
    webPreferences: { session: browsingSession, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  if (scope === 'linuxdo') window.webContents.on('page-title-updated', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (scope === 'linuxdo' ? !linuxDoNavigationAllowed(url) : !/^https?:\/\//i.test(url)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (scope === 'linuxdo' ? !linuxDoNavigationAllowed(url) : !/^https?:\/\//i.test(url)) event.preventDefault();
  });
  return window;
}

async function loadDocument(window: BrowserWindow, url: string, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) throw new Error('BROWSER_CANCELLED');
  const onAbort = () => { if (!window.isDestroyed()) window.destroy(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const contents = window.webContents;
      let settled = false;
      const done = (error?: Error, redirect?: string) => {
        if (settled) return;
        settled = true;
        contents.removeListener('dom-ready', ready);
        contents.removeListener('will-redirect', redirected);
        window.removeListener('closed', cancelled);
        if (error) reject(error); else resolve(redirect ?? null);
      };
      const ready = () => done();
      const cancelled = () => done(new Error('BROWSER_CANCELLED'));
      const redirected = (event: Electron.Event, target: string, _inPlace: boolean, isMainFrame: boolean) => {
        if (!isMainFrame) return;
        event.preventDefault();
        done(undefined, target);
      };
      contents.once('dom-ready', ready);
      contents.on('will-redirect', redirected);
      window.once('closed', cancelled);
      void contents.loadURL(url).catch((error) => done(error));
    });
  } finally { signal.removeEventListener('abort', onAbort); }
}

function executeCancellableScript(window: BrowserWindow, script: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const finish = (error?: unknown, value?: unknown) => {
      signal.removeEventListener('abort', cancel);
      window.removeListener('closed', cancel);
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(new Error('BROWSER_CANCELLED'));
    if (signal.aborted || window.isDestroyed()) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    window.once('closed', cancel);
    // Chromium can leave executeJavaScript pending when its document is destroyed.
    // Rejection enters the host's finally block, which still awaits native cleanup.
    void window.webContents.executeJavaScript(script).then((value) => finish(undefined, value), finish);
  });
}

export async function runBrowserRequest(input: BrowserRequest, signal = new AbortController().signal): Promise<BrowserResult> {
  if (closed) throw new Error('BROWSER_SHUTDOWN');
  if (input.kind === 'html' && (input.session !== undefined && !['public', 'wechat'].includes(input.session)
    || input.selector !== undefined && input.selector !== '#js_content')) throw new Error('BROWSER_INVALID_REQUEST');
  if ('priority' in input && input.priority !== undefined && !['critical', 'interactive', 'scheduled', 'background'].includes(input.priority)) {
    throw new Error('BROWSER_INVALID_REQUEST');
  }
  if (signal.aborted) throw new Error('BROWSER_CANCELLED');
  if (input.kind === 'linuxdo-login') return openLinuxDoVerification(signal);
  if (input.kind === 'wechat-login') {
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.show(); loginWindow.focus();
      return { ok: true, alreadyOpen: true };
    }
    const window = createBrowserWindow(true, 'wechat');
    loginWindow = window;
    window.once('closed', () => { if (loginWindow === window) loginWindow = null; });
    // A login page can remain visible through a network failure and be reloaded by the user.
    void window.loadURL('https://mp.weixin.qq.com').catch((error) => console.warn('[browser] login page load failed', error.message));
    return { ok: true };
  }
  const linuxDo = input.kind === 'linuxdo-feed';
  const script = linuxDo ? linuxDoFetchScript(input.url, input.headers) : null;
  let url = new URL(linuxDo ? 'https://linux.do/' : input.url);
  const validateUrl = () => {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('BROWSER_INVALID_URL');
  };
  validateUrl();
  const waitingSince = performance.now();
  let releaseSlot: (() => void) | undefined;
  let releaseNetwork: (() => void) | undefined;
  let window: BrowserWindow | null = null;
  let retireLinuxDo: (() => Promise<void>) | undefined;
  const controller = new AbortController();
  pageControllers.add(controller);
  const cancel = () => controller.abort(new Error('BROWSER_CANCELLED'));
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 45_000);
  const destroy = () => { if (window && !window.isDestroyed()) window.destroy(); };
  controller.signal.addEventListener('abort', destroy, { once: true });
  try {
    if (signal.aborted || closed) throw new Error('BROWSER_CANCELLED');
    const priority = input.priority ?? 'interactive';
    releaseSlot = await browserSlots.acquire({ key: url.hostname, limit: 1, priority }, controller.signal);
    recordMetric('browser.wait', performance.now() - waitingSince);
    for (let redirects = 0; ; redirects++) {
      validateUrl();
      if (!linuxDo) releaseNetwork = await acquireNetworkSlot(url.href, controller.signal, 1, priority);
      if (controller.signal.aborted) throw new Error('BROWSER_CANCELLED');
      window = createBrowserWindow(false, linuxDo ? 'linuxdo' : input.kind === 'html' ? input.session ?? 'public' : 'public');
      if (linuxDo) retireLinuxDo = linuxDoAdmission!.own(window.webContents.id, priority);
      const target = await loadDocument(window, url.href, controller.signal);
      if (!target) break;
      destroy(); window = null;
      await retireLinuxDo?.(); retireLinuxDo = undefined;
      releaseNetwork?.(); releaseNetwork = undefined;
      if (redirects >= 5) throw new Error('BROWSER_TOO_MANY_REDIRECTS');
      url = new URL(target, url);
      if (linuxDo && !linuxDoNavigationAllowed(url.href)) throw new Error('LINUXDO_VERIFICATION_REQUIRED');
    }
    if (script) {
      const result = await executeCancellableScript(window, script, controller.signal) as {
        status: number; body: string; headers: Record<string, string>;
      } | null;
      if (!result || !Number.isInteger(result.status) || result.status < 100 || result.status > 599
        || typeof result.body !== 'string' || Buffer.byteLength(result.body) > 8 * 1024 * 1024
        || !result.headers || typeof result.headers !== 'object'
        || Object.entries(result.headers).some(([key, value]) => !['content-type', 'etag', 'last-modified', 'retry-after', 'cf-mitigated'].includes(key)
          || typeof value !== 'string' || value.length > 8192)) throw new Error('BROWSER_INVALID_RESPONSE');
      return result;
    }
    if (input.kind === 'html' && input.selector) {
      const until = Date.now() + 10_000;
      while (!await window.webContents.executeJavaScript('Boolean(document.querySelector("#js_content"))')) {
        if (Date.now() >= until) throw new Error('BROWSER_CONTENT_NOT_FOUND');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const html = await window.webContents.executeJavaScript(`(() => {
      const root = document.documentElement.cloneNode(true);
      root.querySelectorAll('img[data-src],img[data-original]').forEach(img => {
        img.setAttribute('src', img.getAttribute('data-src') || img.getAttribute('data-original'));
      });
      return root.outerHTML;
    })()`) as string;
    if (Buffer.byteLength(html) > 8 * 1024 * 1024) throw new Error('BROWSER_RESPONSE_TOO_LARGE');
    return { html };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('BROWSER_CANCELLED');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    destroy();
    await retireLinuxDo?.();
    pageControllers.delete(controller);
    releaseNetwork?.();
    releaseSlot?.();
  }
}

async function openLinuxDoVerification(signal: AbortSignal): Promise<BrowserResult> {
  if (linuxDoLogin && !linuxDoLogin.window.isDestroyed()) {
    linuxDoLogin.window.show(); linuxDoLogin.window.focus();
    return linuxDoLogin.done;
  }
  const window = createBrowserWindow(true, 'linuxdo');
  const retire = linuxDoAdmission!.own(window.webContents.id, 'interactive');
  const cancel = () => { if (!window.isDestroyed()) window.destroy(); };
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const touch = () => { clearTimeout(timer); timer = setTimeout(() => { expired = true; cancel(); }, 10 * 60_000); };
  const done = new Promise<BrowserResult>((resolve, reject) => {
    window.once('closed', () => {
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      linuxDoLogin = null;
      void retire().then(() => signal.aborted || closed ? reject(new Error('BROWSER_CANCELLED'))
        : expired ? reject(new Error('LINUXDO_VERIFICATION_EXPIRED')) : resolve({ ok: true }), reject);
    });
  });
  linuxDoLogin = { window, done };
  signal.addEventListener('abort', cancel, { once: true });
  window.webContents.on('before-input-event', touch);
  window.webContents.on('did-navigate', touch);
  touch();
  void window.loadURL('https://linux.do/').catch(() => { /* Keep the user-controlled window available for retry. */ });
  return done;
}

export function handleBrowserMessage(worker: ChildProcess, message: { type: string; id?: string; input?: BrowserRequest }) {
  if (message.type !== 'browser:request' && message.type !== 'browser:cancel') return false;
  if (typeof message.id !== 'string') return true;
  const key = `${worker.pid}:${message.id}`;
  if (message.type === 'browser:cancel') { active.get(key)?.abort(); return true; }
  const controller = new AbortController();
  active.set(key, controller);
  const input = message.input;
  const request = input && (input.kind === 'html' || input.kind === 'linuxdo-feed' && isLinuxDoFeedUrl(input.url))
    ? runBrowserRequest(input, controller.signal) : Promise.reject(new Error('BROWSER_INVALID_REQUEST'));
  void request.then(
    (result) => send({ result }),
    (error) => send({ error: error instanceof Error ? error.message : String(error) }),
  ).finally(() => active.delete(key));
  function send(payload: object) {
    if (worker.connected && !worker.killed) worker.send({ type: 'browser:result', id: message.id, ...payload }, () => {});
  }
  return true;
}

export function cancelBrowserOwner(pid: number | undefined) {
  for (const [key, controller] of active) if (key.startsWith(`${pid}:`)) controller.abort();
}

export function closeBrowserHost() {
  closed = true;
  for (const controller of active.values()) controller.abort();
  for (const controller of pageControllers) controller.abort();
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.destroy();
  if (linuxDoLogin && !linuxDoLogin.window.isDestroyed()) linuxDoLogin.window.destroy();
}
