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
  screen,
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

/** 所有窗口（多窗口 = 标签页被拖出后的独立窗口） */
const windows = new Set();
let mainWindow = null;
let devHooked = false;

/**
 * 创建窗口。
 * opts.file  启动时要打开的 PDF（会作为该窗口的一个标签页）
 * opts.page  打开后跳到的页码（1 起）
 * opts.bounds 窗口位置与大小（拖出标签页时落在鼠标附近）
 */
function createWindow(opts = {}) {
  const b = opts.bounds || {};
  const win = new BrowserWindow({
    width: b.width || 1280,
    height: b.height || 860,
    x: b.x,
    y: b.y,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#f5f5f5',
    icon: path.join(ASSETS_DIR, 'pdf-icon-256.png'),
    title: 'PDF Reader',
    show: false,
    // 无边框：最小化/最大化/关闭按钮由渲染层画在标签条同一行
    frame: false,
    thickFrame: true,
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

  win.__allowClose = false;
  win.__pendingOpen = opts.file ? { path: opts.file, page: opts.page || 0 } : null;
  windows.add(win);
  mainWindow = win;

  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);

  win.loadURL('app://bundle/index.html');

  win.once('ready-to-show', () => {
    if (!HEADLESS) win.show();
    broadcastWindowCount();
    if (win.__pendingOpen) {
      win.webContents.send('open-file', win.__pendingOpen);
      win.__pendingOpen = null;
    }
    // 开发自检只在第一个窗口里跑一次，避免新建窗口重复执行
    if (DEV_HOOK && !devHooked) {
      devHooked = true;
      attachDevHook(win);
    }
  });

  // 外部链接用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('focus', () => {
    mainWindow = win;
  });

  // 最大化状态变化 -> 通知渲染层切换「最大化/还原」图标
  const sendMaxState = (v) => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized', v);
  };
  win.on('maximize', () => sendMaxState(true));
  win.on('unmaximize', () => sendMaxState(false));

  // 开发期把渲染进程的报错转发到终端，便于无头自检
  if (DEV_HOOK) {
    win.webContents.on('console-message', (...args) => {
      let level = 0;
      let message = '';
      if (args[0] && typeof args[0] === 'object' && 'message' in args[0]) {
        level = args[0].level === 'error' ? 3 : args[0].level === 'warning' ? 2 : 0;
        message = args[0].message;
      } else {
        level = args[1];
        message = args[2];
      }
      if (level >= 2) console.log('RENDERER:' + message);
    });
    win.webContents.on('preload-error', (_e, p, err) => console.log('PRELOAD_ERR:' + err.message));
  }

  win.on('closed', () => {
    windows.delete(win);
    if (mainWindow === win) mainWindow = [...windows].pop() || null;
    broadcastWindowCount();
  });

  // 有未保存修改时拦截关闭
  win.on('close', (e) => {
    if (!win.__allowClose) {
      e.preventDefault();
      win.webContents.send('close-request');
    }
  });

  return win;
}

/** 把当前窗口数量告诉所有窗口（渲染层据此决定单标签的拖动行为） */
function broadcastWindowCount() {
  for (const w of windows) {
    if (!w.isDestroyed()) w.webContents.send('windows:count', windows.size);
  }
}

/** 开发期自检：跑测试脚本 / 截图后退出（打包后不生效） */
function attachDevHook(win) {
  setTimeout(async () => {
    if (process.env.PDFREADER_TEST) {
      try {
        const code = fs.readFileSync(process.env.PDFREADER_TEST, 'utf8');
        const res = await win.webContents.executeJavaScript(code, true);
        console.log('TEST_RESULT:' + JSON.stringify(res));
      } catch (e) {
        console.log('TEST_ERROR:' + (e && e.message));
      }
    }
    console.log('WINDOWS:' + windows.size);
    // 可选：核对被拖出的窗口里确实打开了对应文档
    if (process.env.PDFREADER_DETACH_CHECK) {
      await new Promise((r) => setTimeout(r, 3000));
      for (const w of windows) {
        if (w === win || w.isDestroyed()) continue;
        try {
          const info = await w.webContents.executeJavaScript(
            '({ tabs: App.tabs.list.map((t) => t.state.fileName), pages: App.state.pages.length, hasDoc: !!App.state.pdfDoc, tabEls: document.querySelectorAll("#tabstrip .tab").length })',
            true
          );
          console.log('DETACHED:' + JSON.stringify(info));
        } catch (e) {
          console.log('DETACHED_ERR:' + (e && e.message));
        }
      }
    }
    if (process.env.PDFREADER_SHOT) {
      try {
        // 强制重绘，避免截到旧帧
        win.webContents.invalidate();
        await new Promise((r) => setTimeout(r, 1200));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.PDFREADER_SHOT, img.toPNG());
        console.log('shot saved');
      } catch (e) {
        console.error(e);
      }
    }
    app.quit();
  }, Number(process.env.PDFREADER_SHOT_DELAY || 4000));
}

ipcMain.handle('app:allow-close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  win.__allowClose = true;
  win.close();
  return true;
});

/** 标签页被拖出标签条：在鼠标位置开一个新窗口，并打开同一个文件 */
ipcMain.handle('tab:detach', async (e, payload) => {
  if (!payload || !payload.path) return { merged: false };
  const src = BrowserWindow.fromWebContents(e.sender);
  const pt = screen.getCursorScreenPoint();

  // 1) 松手落在另一个窗口上 -> 把标签合并过去（从别的窗口拖回来就是这条路径）
  const target = [...windows].find((w) => {
    if (!w || w === src || w.isDestroyed() || !w.isVisible()) return false;
    const b = w.getBounds();
    return pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;
  });
  if (target) {
    if (target.isMinimized()) target.restore();
    target.webContents.send('open-file', { path: payload.path, page: payload.page || 0 });
    target.focus();
    return { merged: true };
  }

  // 2) 只有一个标签的窗口拖到空白处：不新建窗口（否则会多出一个只含同一文件的窗口）
  if (payload.only) return { merged: false, skipped: true };

  // 3) 否则在鼠标位置开一个新窗口
  const sb = src && !src.isDestroyed() ? src.getBounds() : { width: 1280, height: 860 };
  const area = screen.getDisplayNearestPoint(pt).workArea;
  const width = Math.min(sb.width, area.width);
  const height = Math.min(sb.height, area.height);
  const x = Math.round(Math.min(Math.max(pt.x - 180, area.x), area.x + area.width - width));
  const y = Math.round(Math.min(Math.max(pt.y - 16, area.y), area.y + area.height - height));
  createWindow({
    file: payload.path,
    page: payload.page || 0,
    bounds: { x, y, width, height },
  });
  return { merged: false };
});

app.on('second-instance', (_e, argv) => {
  const file = pdfFromArgv(argv);
  const win = mainWindow || [...windows][0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    if (file) win.webContents.send('open-file', { path: file });
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

  const startupFile = pdfFromArgv(process.argv);

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

  createWindow({ file: startupFile });

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
  const win = mainWindow || [...windows][0];
  if (win) win.webContents.send('open-file', { path: filePath });
  else createWindow({ file: filePath });
});

/* --------------------------------- IPC --------------------------------- */

ipcMain.handle('dialog:open', async (e) => {
  const settings = readSettings();
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender) || mainWindow, {
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

ipcMain.handle('dialog:saveAs', async (e, suggestedName, data) => {
  const settings = readSettings();
  const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender) || mainWindow, {
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

/* ---------------------------- 自绘窗口按钮 ---------------------------- */

ipcMain.handle('window:minimize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  // 自检模式窗口是隐藏的，最小化/最大化会把它弹到屏幕上，直接忽略
  if (win && !HEADLESS) win.minimize();
  return true;
});

ipcMain.handle('window:toggleMaximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  if (HEADLESS) return win.isMaximized();
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle('window:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.close(); // 走 close 拦截：有未保存修改时由渲染层确认
  return true;
});

ipcMain.handle('window:count', () => windows.size);

ipcMain.handle('window:isMaximized', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  return win ? win.isMaximized() : false;
});

ipcMain.handle('window:fullscreen', (e, value) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  const next = typeof value === 'boolean' ? value : !win.isFullScreen();
  win.setFullScreen(next);
  return next;
});

ipcMain.handle('window:isFullscreen', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  return win ? win.isFullScreen() : false;
});

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
      if (!win.isDestroyed()) win.close();
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
