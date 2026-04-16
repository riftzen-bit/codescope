import { app, BrowserWindow, Menu, session } from 'electron';
import path from 'node:path';
import { registerHandlers } from './ipc/handlers.js';

function buildAppMenu(): Electron.Menu {
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  });

  return Menu.buildFromTemplate(template);
}

function getAllowedRendererOrigin(): string | undefined {
  const raw = process.env.ELECTRON_RENDERER_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    ...(process.platform === 'linux' ? {
      icon: app.isPackaged
        ? path.join(process.resourcesPath, 'icon-256.png')
        : path.join(__dirname, '../../resources/icon-256.png'),
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Preload uses only contextBridge + ipcRenderer; no direct Node APIs needed.
      sandbox: true,
    },
  });

  // Deny all window.open() calls from the renderer
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Prevent renderer from navigating to arbitrary URLs
  const devUrl = getAllowedRendererOrigin();
  const devOrigin = devUrl ? new URL(devUrl).origin : null;
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = devOrigin
      ? new URL(url).origin === devOrigin
      : url.startsWith('app://');
    if (!allowed) event.preventDefault();
  });

  if (devUrl) {
    win.loadURL(devUrl);
    if (process.env.OPEN_DEVTOOLS === '1') {
      win.webContents.openDevTools();
    }
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(async () => {
  // macOS and Linux get a menu with Edit shortcuts; Windows uses no menu bar
  Menu.setApplicationMenu(process.platform === 'win32' ? null : buildAppMenu());

  // Inject Content-Security-Policy for production responses only.
  // In dev mode the Vite dev server serves via localhost and @vitejs/plugin-react
  // injects an inline HMR preamble script that a strict CSP would block.
  if (!process.env.ELECTRON_RENDERER_URL) {
    // 'unsafe-inline' for style-src is required: Monaco Editor and React inject
    // runtime style tags that cannot use nonces without patching the libraries.
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "style-src-elem 'self' 'unsafe-inline'",
      "style-src-attr 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-src 'none'",
      "child-src 'none'",
      "worker-src 'self'",
      "font-src 'self'",
    ];
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [cspDirectives.join('; ')],
        },
      });
    });
  }

  // Handlers registered before window creation; all handlers resolve
  // BrowserWindow lazily at invocation time, so ordering is safe.
  await registerHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
