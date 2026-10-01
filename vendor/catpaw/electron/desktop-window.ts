import { app, BrowserWindow, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { secureReaderWindow } from './security/renderer-policy';
import { getThemePreference } from './data/appearance-repo';
const isDev = !app.isPackaged;
const devServerUrl = `http://localhost:${process.env.CATPAW_DEV_PORT || '5173'}`;
const forceStaticRenderer = process.env.CATPAW_FORCE_STATIC_RENDERER === '1';
let mainWindow: BrowserWindow | null = null;
let rendererUrl = '';
export function getMainWindow() { return mainWindow; }
export function getRendererUrl() { return rendererUrl; }
// Match the selected appearance before the renderer has painted.
function getWindowBackground() {
  return nativeTheme.shouldUseDarkColors ? '#191c17' : '#f0f1eb';
}
function resolvePreloadPath() {
  const candidates = [
    path.join(app.getAppPath(), 'electron', 'preload.js'),
    path.join(app.getAppPath(), 'preload.js'),
    path.join(process.cwd(), 'electron', 'preload.js'),
    path.join(__dirname, 'preload.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(app.getAppPath(), 'electron', 'preload.js');
}

function resolveRendererHtmlPath() {
  const candidates = [
    path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'),
    path.join(process.cwd(), 'dist', 'renderer', 'index.html'),
    path.join(__dirname, '../renderer/index.html'),
    path.join(__dirname, '../../dist/renderer/index.html'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(__dirname, '../renderer/index.html');
}

export function createWindow() {
  const preloadPath = isDev ? resolvePreloadPath() : path.join(__dirname, 'preload.js');
  rendererUrl = isDev && !forceStaticRenderer ? devServerUrl + '/' : pathToFileURL(resolveRendererHtmlPath()).href;
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); return; }
  nativeTheme.themeSource = getThemePreference();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 650,
    show: false,
    backgroundColor: getWindowBackground(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--catpaw-renderer-url=${encodeURIComponent(rendererUrl)}`],
    },
  });

  secureReaderWindow(mainWindow, rendererUrl);
  void mainWindow.loadURL(rendererUrl);

  let shown = false;
  const showWhenReady = () => {
    if (shown || !mainWindow) return;
    shown = true;
    mainWindow.show();
  };
  mainWindow.once('ready-to-show', showWhenReady);
  setTimeout(showWhenReady, 2500);

  const syncWindowBackground = () => mainWindow?.setBackgroundColor(getWindowBackground());
  nativeTheme.on('updated', syncWindowBackground);
  mainWindow.on('closed', () => {
    nativeTheme.removeListener('updated', syncWindowBackground);
    mainWindow = null;
  });
}
