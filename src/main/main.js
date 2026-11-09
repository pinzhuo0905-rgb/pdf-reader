'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  protocol,
  net,
  nativeTheme,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const ocrEngine = require('./ocr');

const APP_DIR = path.join(__dirname, '..');
const RENDERER_DIR = path.join(APP_DIR, 'renderer');
const ASSETS_DIR = path.join(APP_DIR, '..', 'assets');
const MODELS_DIR = path.join(ASSETS_DIR, 'models');

// 单实例 + 文件关联（双击 .pdf 打开）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let pendingFilePath = null;

/** 从命令行参数中解析出待打开的 pdf 路径 */
function pdfFromArgv(argv) {
  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith('-')) continue;
    const p = raw.replace(/^"|"$/g, '');
    if (/\.pdf$/i.test(p) && fs.existsSync(p)) return path.resolve(p);
  }
  return null;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

/* ------------------------------- 设置存储 ------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bcmap': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pfb': 'application/octet-stream',
  '.map': 'application/json',
};

function mimeOf(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

const DEFAULT_SETTINGS = {
  theme: 'light', // light | dark | system
  defaultZoom: 'auto', // auto | fitWidth | fitPage | 100
  showPageNumber: true,
  lastDir: '',
};

function readSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.error('write settings failed', err);
  }
  return next;
}

/* --------------------------------- 窗口 --------------------------------- */

// 自检模式（仅开发期有效）：窗口不显示，仅在后台渲染，避免打扰使用者的桌面
const DEV_HOOK = !app.isPackaged && !!(process.env.PDFREADER_TEST || process.env.PDFREADER_SHOT);
const HEADLESS = DEV_HOOK;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#f5f5f5',
    icon: path.join(ASSETS_DIR, 'pdf-icon-256.png'),
    title: 'PDF 阅读器',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      // pdf.js 在渲染线程使用 worker，需要允许 worker
      webSecurity: true,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadURL('app://bundle/index.html');

  mainWindow.once('ready-to-show', () => {
    if (!HEADLESS) mainWindow.show();
    if (pendingFilePath) {
      mainWindow.webContents.send('open-file', pendingFilePath);
      pendingFilePath = null;
    }
    // 开发自检：执行测试脚本 / 截图后退出（打包后不生效）
    if (DEV_HOOK) {
      setTimeout(async () => {
        if (process.env.PDFREADER_TEST) {
          try {
            const code = fs.readFileSync(process.env.PDFREADER_TEST, 'utf8');
            const res = await mainWindow.webContents.executeJavaScript(code, true);
            console.log('TEST_RESULT:' + JSON.stringify(res));
          } catch (e) {
            console.log('TEST_ERROR:' + (e && e.message));
          }
        }
        if (process.env.PDFREADER_SHOT) {
          try {
            // 强制重绘，避免截到旧帧
            mainWindow.webContents.invalidate();
            await new Promise((r) => setTimeout(r, 1200));
            const img = await mainWindow.webContents.capturePage();
            fs.writeFileSync(process.env.PDFREADER_SHOT, img.toPNG());
            console.log('shot saved');
          } catch (e) {
            console.error(e);
          }
        }
        app.quit();
      }, Number(process.env.PDFREADER_SHOT_DELAY || 4000));
    }
  });

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 有未保存修改时拦截关闭
  mainWindow.on('close', (e) => {
    if (!allowClose) {
      e.preventDefault();
      mainWindow.webContents.send('close-request');
    }
  });
}

let allowClose = false;

ipcMain.handle('app:allow-close', () => {
  allowClose = true;
  if (mainWindow) mainWindow.close();
  return true;
});

app.on('second-instance', (_e, argv) => {
  const file = pdfFromArgv(argv);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (file) mainWindow.webContents.send('open-file', file);
  }
});

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let base = RENDERER_DIR;
    let sub = rel;
    if (rel.startsWith('assets/')) {
      base = ASSETS_DIR;
      sub = rel.slice('assets/'.length);
    }
    const target = path.resolve(base, sub);
    if (!target.startsWith(path.resolve(base))) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const data = await fsp.readFile(target);
      return new Response(data, {
        headers: { 'content-type': mimeOf(target) },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  pendingFilePath = pdfFromArgv(process.argv);

  // 打包后自检：验证 OCR 模型与原生推理库可用（不读取外部脚本）
  if (process.env.PDFREADER_OCR_SELFTEST) {
    (async () => {
      try {
        const t0 = Date.now();
        const w = 320;
        const h = 320;
        const blank = new Uint8Array(w * h * 4).fill(255);
        const res = await ocrEngine.recognize(
          { width: w, height: h, data: Buffer.from(blank) },
          MODELS_DIR,
          { lang: 'auto' }
        );
        // 再强制英文模型，验证 en 权重与字典也在包里
        const resEn = await ocrEngine.recognize(
          { width: w, height: h, data: Buffer.from(blank) },
          MODELS_DIR,
          { lang: 'en' }
        );
        console.log(
          'OCR_SELFTEST ok',
          'ms=' + (Date.now() - t0),
          'ch_boxes=' + res.detCount,
          'en_boxes=' + resEn.detCount,
          'en_lang=' + resEn.lang
        );
      } catch (e) {
        console.log('OCR_SELFTEST fail:', (e && e.message) || e);
      }
      app.quit();
    })();
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// 通过文件关联双击打开（macOS 风格事件，Windows 下也走 open-file 的情况极少）
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) mainWindow.webContents.send('open-file', filePath);
  else pendingFilePath = filePath;
});

/* --------------------------------- IPC --------------------------------- */

ipcMain.handle('dialog:open', async () => {
  const settings = readSettings();
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '打开',
    defaultPath: settings.lastDir || undefined,
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const p = res.filePaths[0];
  writeSettings({ lastDir: path.dirname(p) });
  return p;
});

ipcMain.handle('file:read', async (_e, filePath) => {
  const buf = await fsp.readFile(filePath);
  return { data: buf, path: filePath, name: path.basename(filePath) };
});

ipcMain.handle('file:info', async (_e, filePath) => {
  try {
    const st = await fsp.stat(filePath);
    return { exists: true, size: st.size, mtime: st.mtimeMs, name: path.basename(filePath) };
  } catch {
    return { exists: false };
  }
});

ipcMain.handle('file:save', async (_e, filePath, data) => {
  await fsp.writeFile(filePath, Buffer.from(data));
  return { ok: true, path: filePath };
});

ipcMain.handle('dialog:saveAs', async (_e, suggestedName, data) => {
  const settings = readSettings();
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '另存为',
    defaultPath: path.join(settings.lastDir || app.getPath('documents'), suggestedName || '未命名.pdf'),
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false };
  await fsp.writeFile(res.filePath, Buffer.from(data));
  writeSettings({ lastDir: path.dirname(res.filePath) });
  return { ok: true, path: res.filePath, name: path.basename(res.filePath) };
});

ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, patch) => writeSettings(patch));

// 加载系统中文字体（用于把中文文本写入 PDF）
const CJK_CANDIDATES = [
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/Deng.ttf',
  'C:/Windows/Fonts/simsunb.ttf',
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/simsun.ttc',
];

ipcMain.handle('font:load', async () => {
  for (const p of CJK_CANDIDATES) {
    try {
      const buf = await fsp.readFile(p);
      if (buf.length > 100000) return { data: buf, path: p };
    } catch {
      /* 继续尝试 */
    }
  }
  return { data: null };
});

/* --------------------------------- OCR --------------------------------- */

ipcMain.handle('ocr:warmup', async () => {
  try {
    await ocrEngine.load(MODELS_DIR);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message };
  }
});

ipcMain.handle('ocr:recognize', async (_e, img) => {
  try {
    if (!img || !img.width || !img.height || !img.data) {
      return { ok: false, error: '图像数据无效' };
    }
    const res = await ocrEngine.recognize(
      { width: img.width, height: img.height, data: Buffer.from(img.data) },
      MODELS_DIR,
      { lang: img.lang || 'auto' }
    );
    return { ok: true, ...res };
  } catch (e) {
    console.error('ocr failed', e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('shell:showItem', (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

// 打开 Windows「默认应用」设置，便于把本程序设为 .pdf 的默认打开方式
ipcMain.handle('shell:defaultApps', async () => {
  try {
    await shell.openExternal('ms-settings:defaultapps');
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('app:version', () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
}));

ipcMain.handle('window:fullscreen', (_e, value) => {
  if (!mainWindow) return false;
  const next = typeof value === 'boolean' ? value : !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

ipcMain.handle('window:isFullscreen', () => (mainWindow ? mainWindow.isFullScreen() : false));

// 打印：由渲染进程提供页面图片与尺寸，这里开一个隐藏窗口打印
ipcMain.handle('print:pages', async (_e, payload) => {
  const { pages, pageSize } = payload;
  const html = buildPrintHtml(pages, pageSize);
  const tmpFile = path.join(app.getPath('temp'), `pdfreader-print-${Date.now()}.html`);
  await fsp.writeFile(tmpFile, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: false, sandbox: false },
  });
  await win.loadURL(pathToFileURL(tmpFile).toString());
  return new Promise((resolve) => {
    win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
      win.close();
      fsp.unlink(tmpFile).catch(() => {});
      resolve({ success, reason });
    });
  });
});

function buildPrintHtml(pages, pageSize) {
  // pages: [{ dataUrl, width, height }] 单位为 CSS px（已按 PDF 点尺寸 * 4 渲染）
  const first = pageSize || { width: 595, height: 842 };
  const css = pages
    .map(
      (p) =>
        `<div class="page"><img src="${p.dataUrl}" style="width:${p.width}px;height:${p.height}px"/></div>`
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${first.width}px ${first.height}px; margin: 0; }
    html,body{margin:0;padding:0;background:#fff;}
    .page{page-break-after:always;break-after:page;}
    .page:last-child{page-break-after:auto;break-after:auto;}
    img{display:block;}
  </style></head><body>${css}</body></html>`;
}
