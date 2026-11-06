const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const productTitle = 'المكتبة الرقمية — قلم';
const appDirectory = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
const originalsRoot = path.resolve(appDirectory, '..');
const resourcesLibrary = path.join(process.resourcesPath, 'library');
const databasePath = path.join(appDirectory, 'data', 'library.sqlite');
let service;
let mainWindow;
let quitting = false;

app.setName(productTitle);
app.setAppUserModelId('ma.qalam.digital-library');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(startApplication).catch(showStartupError);
}

async function choosePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`تعذر تشغيل واجهة المكتبة محلياً: ${String(lastError?.message || 'انتهت مهلة بدء الخدمة')}`);
}

async function startApplication() {
  if (!fs.existsSync(databasePath)) {
    throw new Error('قاعدة المكتبة غير موجودة. افتح البرنامج من مجلد المكتبة الرقمية الذي يحتوي مجلد data.');
  }
  if (!fs.existsSync(path.join(resourcesLibrary, 'server.mjs'))) {
    throw new Error('ملفات البرنامج غير مكتملة. أعد استخراج حزمة المكتبة الرقمية كاملة.');
  }

  const port = await choosePort();
  process.env.NODE_ENV = 'development';
  process.env.QALAM_DESKTOP_MODE = '1';
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.QALAM_DB_PATH = databasePath;
  process.env.QALAM_LOCAL_ORIGINALS_ROOT = originalsRoot;

  service = await import(pathToFileURL(path.join(resourcesLibrary, 'server.mjs')).href);
  const appUrl = `http://127.0.0.1:${port}`;
  await waitForServer(appUrl);
  createWindow(appUrl);
}

function createWindow(appUrl) {
  const iconPath = path.join(resourcesLibrary, 'public', 'assets', 'library-icon-192.png');
  mainWindow = new BrowserWindow({
    title: productTitle,
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f0e6',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  const localOrigin = new URL(appUrl).origin;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== localOrigin) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(appUrl);
}

async function showStartupError(error) {
  await app.whenReady().catch(() => {});
  dialog.showErrorBox(productTitle, `${error?.message || error}\n\nتأكد من إبقاء مجلد البرنامج وقاعدة المكتبة على USB، وأن مجلدات الأصول الأصلية ما زالت في جذر USB.`);
  app.quit();
}

app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
  const server = service?.server;
  if (server?.listening) server.close(() => service.library?.close?.());
  else service?.library?.close?.();
});

app.on('window-all-closed', () => app.quit());

