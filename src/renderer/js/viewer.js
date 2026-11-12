/* PDF 渲染视图：加载、布局、缩放、懒渲染、文本层、搜索、页面操作 */
(function () {
  const App = (window.App = window.App || {});
  const S = () => App.state;
  const tr = (k, v) => window.App.i18n.t(k, v);

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  /**
   * el 是「当前标签页的视图引用」。
   * 切换标签页时只把 el 上的属性指向该标签页自己的 DOM，
   * 这样所有 el.scroll / el.pages 的用法都不需要改。
   */
  const el = {};
  const cache = {
    textContent: new Map(), // pageId -> {items, styles}
    pageObj: new WeakMap(), // pdfDoc -> Map(src index -> pdfjs page)
  };
  /** 滚动时额外要通知的钩子（文字编辑浮层用来取消编辑） */
  const scrollHooks = [];
  /** 缩放前后要通知的钩子（内联编辑器需要先落笔） */
  const zoomHooks = [];

  const PAD_X = 24;
  /** 双页视图两页之间的横向间距 */
  const TWO_UP_GAP = 10;

  /* ------------------------------- 初始化 ------------------------------- */
  function init() {
    el.views = document.getElementById('views');
    el.main = document.getElementById('main');
    el.pageInput = document.getElementById('page-input');
    el.pageTotal = document.getElementById('page-total');
    el.floatPage = document.getElementById('float-page');
    el.thumbs = document.getElementById('thumbs');
    el.outline = document.getElementById('outline');
    el.sidebar = document.getElementById('sidebar');
    el.loading = document.getElementById('loading');
    el.empty = document.getElementById('empty');

    window.addEventListener('resize', onResize);
    startRepairTimer();
  }

  /** 兜底巡检：可见页如果没画出来（异常中断），自动补一次 */
  function startRepairTimer() {
    setInterval(() => {
      const st = S();
      if (!st.pdfDoc || !el.scroll || st.pages.length > 300) return;
      for (const p of st.pages) {
        if (!p.el || p.rendered) continue;
        const r = p.el.getBoundingClientRect();
        const area = el.scroll.getBoundingClientRect();
        const visible = r.bottom > area.top && r.top < area.bottom;
        if (!visible) continue;
        if (p.rendering) {
          // 渲染任务异常卡住时（极少见）兜底复位，避免一直白页
          if (!p._renderStart) p._renderStart = Date.now();
          else if (Date.now() - p._renderStart > 5000) {
            p.rendering = false;
            p._renderStart = 0;
            renderPage(p.id);
          }
          continue;
        }
        renderPage(p.id);
      }
    }, 1500);
  }

  /* ---------------------------- 每标签页的视图 ---------------------------- */

  /** 为一个标签页创建独立的滚动区与页面容器 */
  function createView(tab) {
    const view = document.createElement('div');
    view.className = 'view';
    view.dataset.tab = tab.id;

    const scroll = document.createElement('div');
    scroll.className = 'scroll-area';
    const pages = document.createElement('div');
    pages.className = 'pages';

    scroll.appendChild(pages);
    view.appendChild(scroll);
    el.views.appendChild(view);

    tab.dom = { view, scroll, pages };

    scroll.addEventListener('scroll', onScroll, { passive: true });
    scroll.addEventListener('wheel', onWheel, { passive: false });
    // 每个视图一个观察器，root 必须是它自己的滚动容器
    tab.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) renderPage(e.target.dataset.id);
        }
      },
      { root: scroll, rootMargin: '600px 0px' }
    );

    return tab.dom;
  }

  /** 把 viewer 的 el 指向某个标签页（切换标签页时调用） */
  function bindTab(tab) {
    if (!tab || !tab.dom) return;
    el.view = tab.dom.view;
    el.scroll = tab.dom.scroll;
    el.pages = tab.dom.pages;
  }

  function destroyView(tab) {
    if (tab.observer) {
      tab.observer.disconnect();
      tab.observer = null;
    }
    if (tab.dom && tab.dom.view) tab.dom.view.remove();
    tab.dom = null;
  }

  /** 注册「滚动时」回调（例如关闭文字编辑浮层） */
  function onScrollHook(fn) {
    scrollHooks.push(fn);
  }

  /** 注册「缩放即将变化」回调（内联编辑需要先提交，否则会跟着缩放错位） */
  function onZoomHook(fn) {
    zoomHooks.push(fn);
  }

  function runZoomHooks() {
    for (const fn of zoomHooks) {
      try {
        fn();
      } catch (e) {
        /* 钩子异常不影响缩放 */
      }
    }
  }

  /* -------------------------------- 加载 -------------------------------- */
  let loadingCount = 0;

  function isLoading() {
    return loadingCount > 0;
  }

  /** 加载期间禁止切换标签页，避免 DOM 与状态错位 */
  async function load(bytes, filePath, fileName, opts = {}) {
    loadingCount++;
    try {
      return await doLoad(bytes, filePath, fileName, opts);
    } finally {
      loadingCount--;
      if (loadingCount === 0 && App.tabs) App.tabs.flushPending();
    }
  }

  async function doLoad(bytes, filePath, fileName, opts = {}) {
    showLoading(tr('loading.opening'));
    const state = S();
    state.bytes = bytes;
    state.filePath = filePath;
    state.fileName = fileName || (filePath ? filePath.split(/[\\/]/).pop() : tr('file.untitled'));
    cache.textContent.clear();
    state.annots = new Map();
    state.ocr = null;
    state.outline = null;
    state.search = { query: '', matches: [], index: -1 };

    try {
      const task = pdfjsLib.getDocument({
        data: bytes.slice(0),
        cMapUrl: 'vendor/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'vendor/standard_fonts/',
        useSystemFonts: true,
        isEvalSupported: false,
        fontExtraProperties: true,
      });
      state.pdfDoc = await task.promise;
    } catch (err) {
      hideLoading();
      App.ui.toast(tr('toast.openFailed', { msg: (err && err.message) || err }));
      console.error(err);
      return false;
    }

    state.numPagesSrc = state.pdfDoc.numPages;
    const model = [];
    for (let i = 0; i < state.numPagesSrc; i++) {
      const page = await getPage(i);
      const vp = page.getViewport({ scale: 1, rotation: 0 });
      model.push({
        id: 'p' + i + '-' + Math.random().toString(36).slice(2, 7),
        src: i,
        rot: page.rotate || 0,
        baseW: vp.width,
        baseH: vp.height,
      });
    }
    state.pages = model.map((m) => hydratePage(m));
    state.currentPage = 0;
    // 刚打开时的内容指纹：之后 Ctrl+S 只在真的改过时才写盘
    state.savedFingerprint = App.history.snapshot();

    // 初始缩放
    computeAutoZoom();
    buildDom();
    // 侧栏若开着，用新文档的页面重建缩略图（激活时文档还没加载完，那里只能清空）
    if (isSidebarOpen()) buildThumbs();
    App.history.reset();
    state.dirty = false;
    hideLoading();
    el.empty.classList.add('hidden');
    el.pages.classList.remove('hidden');
    updatePageIndicator();
    App.ui.setTitle();
    App.ui.setDocState(true);
    buildOutline();
    requestAnimationFrame(() => {
      layout();
      const target = opts.page ? Math.max(0, Math.min(state.pages.length - 1, opts.page - 1)) : 0;
      scrollToPage(target, false);
    });
    return true;
  }

  function hydratePage(m) {
    const rot = ((m.rot % 360) + 360) % 360;
    const swapped = rot % 180 !== 0;
    return {
      ...m,
      rot,
      origRot: rot, // 打开文件时的原始旋转，用于判断「仅旋转」是否需要保存
      wPt: swapped ? m.baseH : m.baseW,
      hPt: swapped ? m.baseW : m.baseH,
      el: null,
      canvas: null,
      overlay: null,
      textLayer: null,
      rendered: false,
      rendering: false,
      textItems: null,
    };
  }

  async function getPage(srcIndex, doc) {
    const pdfDoc = doc || S().pdfDoc;
    if (!pdfDoc) return null;
    let map = cache.pageObj.get(pdfDoc);
    if (!map) {
      map = new Map();
      cache.pageObj.set(pdfDoc, map);
    }
    if (map.has(srcIndex)) return map.get(srcIndex);
    const page = await pdfDoc.getPage(srcIndex + 1);
    map.set(srcIndex, page);
    return page;
  }

  /* ------------------------------ 缩放计算 ------------------------------ */
  /** 双页视图下每页可用的宽度只有单页的一半 */
  function availWidth() {
    const w = el.scroll.clientWidth - PAD_X * 2 - 18;
    return S().twoUp ? Math.max(120, (w - TWO_UP_GAP) / 2) : w;
  }

  function computeAutoZoom() {
    const state = S();
    const first = state.pages[0];
    if (!first) return;
    const availW = availWidth();
    const availH = el.scroll.clientHeight - 40;
    let z;
    if (state.zoomMode === 'fitPage') {
      z = Math.min(availW / first.wPt, availH / first.hPt);
    } else if (state.zoomMode === 'custom') {
      z = state.zoom;
    } else {
      // auto / fitWidth：以当前页宽度适应
      const cur = state.pages[state.currentPage] || first;
      z = availW / cur.wPt;
    }
    state.zoom = Math.max(0.15, Math.min(4, z));
  }

  const clampZoom = (z) => Math.max(0.15, Math.min(5, z));

  function setZoom(z, mode) {
    const state = S();
    runZoomHooks();
    state.zoom = clampZoom(z);
    if (mode) state.zoomMode = mode;
    const anchor = captureAnchor();
    layout();
    restoreAnchor(anchor);
    notifyZoom();
  }

  function notifyZoom() {
    if (App.ui && App.ui.updateZoom) App.ui.updateZoom(S().zoom);
  }

  function zoomIn() {
    animateZoom(S().zoom * 1.15, centerAnchor(), 'custom');
  }
  function zoomOut() {
    animateZoom(S().zoom / 1.15, centerAnchor(), 'custom');
  }
  function fitWidth() {
    S().zoomMode = 'fitWidth';
    computeAutoZoom();
    animateZoom(S().zoom, centerAnchor(), 'fitWidth', 0);
  }
  function fitPage() {
    S().zoomMode = 'fitPage';
    computeAutoZoom();
    animateZoom(S().zoom, centerAnchor(), 'fitPage', 0);
  }

  /** 视口中心的锚点（屏幕坐标），用于键盘/按钮缩放 */
  function centerAnchor() {
    const r = el.scroll.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /**
   * 平滑缩放：先在 .pages 上做 CSS transform 预览（逐帧插值，不触发重绘），
   * 动画结束后再真正改布局。anchor 为屏幕坐标，缩放时该点下的内容保持不动。
   */
  let zoomAnim = null;

  function animateZoom(target, anchor, mode, duration) {
    const st = S();
    const to = clampZoom(target);
    if (!el.pages) {
      setZoom(to, mode);
      return;
    }
    if (!zoomAnim) {
      zoomAnim = { cur: st.zoom, target: st.zoom, raf: 0, anchor: null, mode: null, from: st.zoom, t0: 0 };
    }
    zoomAnim.anchor = anchor || zoomAnim.anchor || centerAnchor();
    zoomAnim.mode = mode || zoomAnim.mode;
    zoomAnim.target = to;
    if (duration === 0) {
      zoomAnim.cur = to;
      finishZoomAnim();
      return;
    }
    if (!zoomAnim.raf) {
      zoomAnim.cur = zoomAnim.cur || st.zoom;
      zoomAnim.raf = requestAnimationFrame(zoomStep);
    }
    // 中途改目标：从当前值重新起算，避免曲线跳变
    zoomAnim.from = zoomAnim.cur;
    zoomAnim.t0 = performance.now();
    // 兜底：窗口不可见时 rAF 会被节流甚至不触发，定时器保证最终一定落位
    clearTimeout(zoomAnim.timer);
    const anim = zoomAnim;
    zoomAnim.timer = setTimeout(() => {
      if (zoomAnim === anim) finishZoomAnim();
    }, 260);
  }

  function zoomStep(now) {
    const a = zoomAnim;
    if (!a) return;
    const dur = 150;
    const k = Math.min(1, (now - a.t0) / dur);
    // easeOutCubic
    const e = 1 - Math.pow(1 - k, 3);
    a.cur = a.from + (a.target - a.from) * e;
    const ratio = a.cur / S().zoom;
    const rect = el.pages.getBoundingClientRect();
    const ox = Math.max(0, Math.min(rect.width, a.anchor.x - rect.left));
    const oy = Math.max(0, Math.min(rect.height, a.anchor.y - rect.top));
    el.pages.style.transformOrigin = ox + 'px ' + oy + 'px';
    el.pages.style.transform = 'scale(' + ratio.toFixed(4) + ')';
    notifyZoomPreview(a.cur);
    if (k >= 1) {
      a.raf = 0;
      finishZoomAnim();
      return;
    }
    a.raf = requestAnimationFrame(zoomStep);
  }

  function notifyZoomPreview(z) {
    if (App.ui && App.ui.updateZoom) App.ui.updateZoom(z, true);
  }

  function finishZoomAnim() {
    const a = zoomAnim;
    zoomAnim = null;
    if (!a) return;
    clearTimeout(a.timer);
    if (el.pages) {
      el.pages.style.transform = '';
      el.pages.style.transformOrigin = '';
    }
    // 让锚点下的内容保持不动：换算成滚动位置
    const anchor = a.anchor;
    const oldZoom = S().zoom;
    const nextZoom = clampZoom(a.target);
    const ratio = nextZoom / (oldZoom || 1);
    const pageTop = el.pages.offsetTop;
    const pageLeft = el.pages.offsetLeft;
    const rect = el.pages.getBoundingClientRect();
    const ox = Math.max(0, Math.min(rect.width, (anchor ? anchor.x : rect.left + rect.width / 2) - rect.left));
    const oy = Math.max(0, Math.min(rect.height, (anchor ? anchor.y : rect.top + rect.height / 2) - rect.top));
    setZoom(nextZoom, a.mode);
    if (anchor && el.scroll) {
      const area = el.scroll.getBoundingClientRect();
      el.scroll.scrollLeft = pageLeft + ox * ratio - (anchor.x - area.left);
      el.scroll.scrollTop = pageTop + oy * ratio - (anchor.y - area.top);
    }
  }

  /** 滚轮缩放：以鼠标位置为锚点 */
  function zoomAt(clientX, clientY, factor) {
    const st = S();
    const base = zoomAnim ? zoomAnim.target : st.zoom;
    animateZoom(base * factor, { x: clientX, y: clientY }, 'custom');
  }

  /** Ctrl + 滚轮：平滑缩放，鼠标下的内容保持不动 */
  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    if (!S().pdfDoc || !el.scroll) return;
    // 只处理当前激活标签页的滚动区
    if (el.scroll !== e.currentTarget) return;
    e.preventDefault();
    const raw = Math.pow(1.0018, -e.deltaY);
    const factor = Math.max(0.75, Math.min(1.34, raw));
    zoomAt(e.clientX, e.clientY, factor);
  }

  /** 滑块直接指定缩放百分比 */
  function zoomTo(z, anchor) {
    S().zoomMode = 'custom';
    animateZoom(z, anchor || centerAnchor(), 'custom');
  }

  /* ------------------------------ DOM 构建 ------------------------------ */
  function buildDom() {
    el.pages.innerHTML = '';
    el.pages.classList.toggle('two-up', !!S().twoUp);
    for (const p of S().pages) createPageEl(p);
  }

  function createPageEl(p) {
    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.id = p.id;
    div.style.width = p.wPt * S().zoom + 'px';
    div.style.height = p.hPt * S().zoom + 'px';

    const canvas = document.createElement('canvas');
    canvas.className = 'base';
    const overlay = document.createElement('canvas');
    overlay.className = 'overlay';
    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';

    div.appendChild(canvas);
    div.appendChild(overlay);
    div.appendChild(textLayer);
    el.pages.appendChild(div);

    p.el = div;
    p.canvas = canvas;
    p.overlay = overlay;
    p.textLayer = textLayer;
    return div;
  }

  function layout() {
    const z = S().zoom;
    let resized = false;
    for (const p of S().pages) {
      if (!p.el) continue;
      const prev = p._layoutZoom || 0;
      const changed = !prev || Math.abs(prev - z) / z > 0.03;
      p.el.style.width = p.wPt * z + 'px';
      p.el.style.height = p.hPt * z + 'px';
      if (changed) {
        // 只有尺寸真的变了才清空重绘；切换标签页时保留已有画布，避免闪白
        p._layoutZoom = z;
        sizeOverlay(p);
        p.rendered = false;
        // 文本层坐标是按当前缩放算的，缩放一变必须作废，否则点选会命中错的行
        p.textItems = null;
        resized = true;
      }
    }
    applySpreadWidth(z);
    renderVisible(resized);
  }

  /**
   * 双页视图：给 .pages 一个「刚好两页」的宽度，flex-wrap 就会每行排两页。
   * （.pages 默认 width:fit-content，不给宽度的话它会把所有页排成一行，看起来和单页没区别）
   */
  function applySpreadWidth(z) {
    if (!el.pages) return;
    const st = S();
    el.pages.classList.toggle('two-up', !!st.twoUp);
    if (!st.twoUp) {
      el.pages.style.width = '';
      return;
    }
    let maxW = 0;
    for (const p of st.pages) maxW = Math.max(maxW, p.wPt * z);
    if (!maxW) {
      el.pages.style.width = '';
      return;
    }
    el.pages.style.width = Math.round(maxW * 2 + TWO_UP_GAP + PAD_X * 2) + 'px';
  }

  function sizeOverlay(p) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(p.wPt * S().zoom));
    const h = Math.max(1, Math.round(p.hPt * S().zoom));
    p.overlay.width = Math.round(w * dpr);
    p.overlay.height = Math.round(h * dpr);
  }

  /* ------------------------------ 懒渲染 ------------------------------ */
  function renderVisible(force) {
    const area = el.scroll.getBoundingClientRect();
    const margin = 700;
    for (const p of S().pages) {
      if (!p.el) continue;
      const r = p.el.getBoundingClientRect();
      if (r.bottom > area.top - margin && r.top < area.bottom + margin) {
        if (force || !p.rendered) renderPage(p.id);
      }
    }
    // 页面过多时释放远处画布
    if (S().pages.length > 40) {
      for (const p of S().pages) {
        if (!p.el || !p.rendered) continue;
        const r = p.el.getBoundingClientRect();
        if (r.bottom < area.top - 2400 || r.top > area.bottom + 2400) {
          p.canvas.width = 1;
          p.canvas.height = 1;
          p.rendered = false;
        }
      }
    }
  }

  async function renderPage(pageId) {
    const st = S();
    const p = st.pages.find((x) => x.id === pageId);
    if (!p || p.src == null) return;
    if (p.rendering) {
      // 正在绘制：记一个待办，等这次结束后再补一次，避免并发绘制同一画布
      p._queued = true;
      return;
    }
    if (p.rendered && p._lastZoom === st.zoom) return;
    p.rendering = true;
    p._renderStart = Date.now();
    p._lastZoom = st.zoom;
    const zoom = st.zoom;
    const dpr = window.devicePixelRatio || 1;
    try {
      const page = await getPage(p.src, st.pdfDoc);
      if (!page) return;
      // 渲染期间切换了标签页：放弃本次绘制，等激活时重来
      if (S() !== st) return;
      const viewport = page.getViewport({ scale: zoom * dpr, rotation: p.rot });
      const canvas = p.canvas;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.style.width = p.wPt * zoom + 'px';
      canvas.style.height = p.hPt * zoom + 'px';
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const task = page.render({ canvasContext: ctx, viewport });
      await task.promise;
      if (S() !== st) return;
      p.rendered = true;
      p.canvas.style.visibility = '';
      await buildTextLayer(p, page, zoom);
      drawOverlay(p);
      renderThumbIfOpen(p);
    } catch (err) {
      if (err && err.name !== 'RenderingCancelledException') console.warn('render fail', err);
      // 渲染失败也要把画布显示出来，否则该页会一直空白
      p.canvas.style.visibility = '';
    } finally {
      p.rendering = false;
      p._renderStart = 0;
      if (p._queued) {
        p._queued = false;
        renderPage(pageId);
      }
    }
  }

  /* ------------------------------- 文本层 ------------------------------- */
  async function buildTextLayer(p, page, zoom) {
    const viewport = page.getViewport({ scale: zoom || S().zoom, rotation: p.rot });
    let tc = cache.textContent.get(p.id);
    if (!tc) {
      const content = await page.getTextContent();
      tc = { items: content.items, styles: content.styles };
      cache.textContent.set(p.id, tc);
    }
    const layer = p.textLayer;
    layer.innerHTML = '';
    const frag = document.createDocumentFragment();
    const spans = [];
    const items = [];
    for (const item of tc.items) {
      if (!item.str) continue;
      const style = tc.styles[item.fontName] || {};
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      if (fontHeight <= 0.5) continue;
      const ascent = style.ascent > 0 ? style.ascent : 0.8;
      const left = tx[4];
      const top = tx[5] - fontHeight * ascent;
      const span = document.createElement('span');
      span.textContent = item.str;
      span.style.left = left.toFixed(2) + 'px';
      span.style.top = top.toFixed(2) + 'px';
      span.style.fontSize = fontHeight.toFixed(2) + 'px';
      span.style.fontFamily = 'sans-serif';
      span.dataset.target = (item.width * viewport.scale).toFixed(2);
      frag.appendChild(span);
      spans.push(span);
      items.push({
        str: item.str,
        left,
        top,
        width: item.width * viewport.scale,
        height: fontHeight,
        fontSize: fontHeight,
        dir: item.dir,
      });
    }
    layer.appendChild(frag);
    // 横向拉伸对齐原始排版
    for (const s of spans) {
      const target = parseFloat(s.dataset.target);
      const natural = s.getBoundingClientRect().width;
      if (natural > 0.5 && target > 0.5) {
        const sx = target / natural;
        if (Math.abs(sx - 1) > 0.02) s.style.transform = `scaleX(${sx.toFixed(3)})`;
      }
    }
    p.textItems = items;
  }

  function getTextItems(pageId) {
    const p = S().pages.find((x) => x.id === pageId);
    return p && p.textItems ? p.textItems : [];
  }

  /* ------------------------------- 标注层 ------------------------------- */
  function drawOverlay(p) {
    const ctx = p.overlay.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = p.overlay.width;
    const H = p.overlay.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.scale(dpr, dpr);
    const w = W / dpr;
    const h = H / dpr;
    const zoom = S().zoom;

    const list = App.annots.get(p.id);
    for (const a of list) App.annotate.paint(ctx, a, w, h, zoom, false);

    // 搜索高亮
    const s = S().search;
    if (s.query && s.matches.length) {
      s.matches.forEach((m, i) => {
        if (m.pageId !== p.id) return;
        const current = i === s.index;
        ctx.save();
        ctx.fillStyle = current ? 'rgba(255,150,0,0.42)' : 'rgba(255,220,0,0.32)';
        for (const r of m.rects) {
          ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
        }
        ctx.restore();
      });
    }

    // OCR 识别框
    const ocr = S().ocr;
    if (ocr && ocr.visible && ocr.pageId === p.id && ocr.boxes && ocr.boxes.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,114,201,0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      for (const b of ocr.boxes) {
        ctx.strokeRect(b.x * w, b.y * h, b.w * w, b.h * h);
      }
      ctx.restore();
    }

    // 文本框：始终显示淡虚线边框，让人一眼看出「这里是一个可拖动的框」
    ctx.save();
    ctx.strokeStyle = 'rgba(0,114,201,0.32)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const a of list) {
      if (a.type !== 'text' && a.type !== 'textedit') continue;
      const isSel = S().selected && S().selected.pageId === p.id && S().selected.annotId === a.id;
      if (isSel) continue; // 选中的由下面统一画（更醒目 + 手柄）
      ctx.strokeRect(a.x * w, a.y * h, a.w * w, a.h * h);
    }
    ctx.restore();

    // 选中框 + 缩放手柄
    if (S().selected && S().selected.pageId === p.id) {
      const a = App.annots.find(p.id, S().selected.annotId);
      if (a) {
        const b = App.annotate.bbox(a);
        ctx.save();
        ctx.strokeStyle = '#0072c9';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(b.x * w, b.y * h, b.w * w, b.h * h);
        if (App.annotate.isBoxAnnot(a)) {
          const pts = App.annotate.handlePoints(a);
          ctx.setLineDash([]);
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#0072c9';
          ctx.lineWidth = 1.2;
          for (const k of App.annotate.HANDLES) {
            const cx = pts[k][0] * w;
            const cy = pts[k][1] * h;
            ctx.beginPath();
            ctx.rect(cx - 3.5, cy - 3.5, 7, 7);
            ctx.fill();
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
  }

  function refreshOverlays() {
    for (const p of S().pages) if (p.overlay && p.rendered) drawOverlay(p);
  }

  /* ------------------------------ 滚动与页码 ------------------------------ */
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      for (const fn of scrollHooks) {
        try {
          fn();
        } catch (e) {
          /* 钩子异常不影响滚动 */
        }
      }
      updatePageIndicator();
      renderVisible(false);
      showFloatPage();
    });
  }
  let scrollRaf = 0;

  function updatePageIndicator() {
    const state = S();
    if (!state.pages.length) return;
    const area = el.scroll.getBoundingClientRect();
    let best = 0;
    let bestDist = Infinity;
    state.pages.forEach((p, i) => {
      if (!p.el) return;
      const r = p.el.getBoundingClientRect();
      const d = Math.abs(r.top - area.top - 8);
      if (r.bottom > area.top + 20 && d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    state.currentPage = best;
    el.pageInput.value = best + 1;
    el.pageTotal.textContent = '/ ' + state.pages.length;
    highlightThumb(best);
  }

  function showFloatPage() {
    el.floatPage.textContent = S().currentPage + 1;
    el.floatPage.classList.remove('hidden');
    clearTimeout(showFloatPage._t);
    showFloatPage._t = setTimeout(() => el.floatPage.classList.add('hidden'), 900);
  }

  function scrollToPage(index, smooth = true) {
    const p = S().pages[index];
    if (!p || !p.el) return;
    const top = Math.max(0, p.el.offsetTop - 14);
    el.scroll.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    S().currentPage = index;
    el.pageInput.value = index + 1;
    highlightThumb(index);
  }

  function captureAnchor() {
    const p = S().pages[S().currentPage];
    if (!p || !p.el) return null;
    const area = el.scroll.getBoundingClientRect();
    const r = p.el.getBoundingClientRect();
    return { index: S().currentPage, ratio: (area.top - r.top) / Math.max(1, r.height) };
  }

  function restoreAnchor(anchor) {
    if (!anchor) return;
    const p = S().pages[anchor.index];
    if (!p || !p.el) return;
    el.scroll.scrollTop = p.el.offsetTop - 8 + anchor.ratio * p.el.offsetHeight;
  }

  /**
   * 切回某个标签页时调用：不重算缩放（避免 1% 的抖动导致整页重绘），
   * 只有当窗口宽度明显变化过才重新适应宽度。
   */
  function resumeView() {
    const st = S();
    if (!el.scroll) return;
    const w = el.scroll.clientWidth;
    const stale = st._viewWidth && Math.abs(st._viewWidth - w) > 24;
    if (stale && (st.zoomMode === 'auto' || st.zoomMode === 'fitWidth' || st.zoomMode === 'fitPage')) {
      computeAutoZoom();
      layout();
    } else {
      renderVisible(false);
    }
    st._viewWidth = w;
    updatePageIndicator();
    notifyZoom();
  }

  function onResize() {
    S()._viewWidth = el && el.scroll ? el.scroll.clientWidth : 0;
    if (!el.scroll || !S().pdfDoc) return;
    if (S().zoomMode === 'fitWidth' || S().zoomMode === 'fitPage' || S().zoomMode === 'auto') {
      const a = captureAnchor();
      computeAutoZoom();
      layout();
      restoreAnchor(a);
    }
  }

  /* ------------------------------ 页面操作 ------------------------------ */

  /**
   * 页面尺寸或数量变化后重排：
   * 旋转/插页/删页都会改变页面尺寸，双页视图下容器宽度必须跟着重算，
   * 否则会出现「一页占满一行」或横向溢出的错乱。
   */
  function relayoutAfterPageChange() {
    const st = S();
    if (st.zoomMode === 'fitWidth' || st.zoomMode === 'fitPage' || st.zoomMode === 'auto') computeAutoZoom();
    const a = captureAnchor();
    layout();
    restoreAnchor(a);
    notifyZoom();
  }
  function rotatePage(index, delta = 90) {
    const state = S();
    const p = state.pages[index];
    if (!p) return;
    p.rot = ((p.rot + delta) % 360 + 360) % 360;
    const swapped = p.rot % 180 !== 0;
    p.wPt = swapped ? p.baseH : p.baseW;
    p.hPt = swapped ? p.baseW : p.baseH;
    p.rendered = false;
    p.textItems = null;
    cache.textContent.delete(p.id);
    // 重建该页 DOM 尺寸。旧画布还是旋转前的比例，先藏起来，
    // 否则在异步重绘完成前会被拉成新比例（画面明显变形）
    p.canvas.style.visibility = 'hidden';
    p.el.style.width = p.wPt * state.zoom + 'px';
    p.el.style.height = p.hPt * state.zoom + 'px';
    sizeOverlay(p);
    state.dirty = true;
    App.history.push();
    renderPage(p.id);
    renderThumbIfOpen(p);
    relayoutAfterPageChange();
    App.ui.toast(tr('toast.pageRotated', { n: index + 1 }));
  }

  function deletePage(index) {
    const state = S();
    if (state.pages.length <= 1) {
      App.ui.toast(tr('toast.keepOnePage'));
      return;
    }
    const p = state.pages[index];
    if (!p) return;
    state.pages.splice(index, 1);
    state.annots.delete(p.id);
    cache.textContent.delete(p.id);
    if (p.el) p.el.remove();
    state.currentPage = Math.min(state.currentPage, state.pages.length - 1);
    state.dirty = true;
    App.history.push();
    updatePageIndicator();
    buildThumbs();
    relayoutAfterPageChange();
    App.ui.toast(tr('toast.pageDeleted', { n: index + 1 }));
  }

  function insertBlankPage(index) {
    const state = S();
    const ref = state.pages[index] || state.pages[state.pages.length - 1];
    const wPt = ref ? (ref.rot % 180 === 0 ? ref.baseW : ref.baseH) : 595;
    const hPt = ref ? (ref.rot % 180 === 0 ? ref.baseH : ref.baseW) : 842;
    const model = {
      id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      src: null,
      rot: 0,
      baseW: wPt,
      baseH: hPt,
    };
    const p = hydratePage(model);
    state.pages.splice(index + 1, 0, p);
    // createPageEl 会追加到末尾，这里把它移到「原 index 页之后」的正确位置
    const div = createPageEl(p);
    const next = state.pages[index + 2];
    if (next && next.el) el.pages.insertBefore(div, next.el);
    // 空白页直接画白
    p.canvas.width = Math.max(1, Math.round(p.wPt * state.zoom * (window.devicePixelRatio || 1)));
    p.canvas.height = Math.max(1, Math.round(p.hPt * state.zoom * (window.devicePixelRatio || 1)));
    p.canvas.style.width = p.wPt * state.zoom + 'px';
    p.canvas.style.height = p.hPt * state.zoom + 'px';
    const c = p.canvas.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, p.canvas.width, p.canvas.height);
    p.textLayer.innerHTML = '';
    p.rendered = true;
    p._lastZoom = state.zoom;
    sizeOverlay(p);
    state.dirty = true;
    App.history.push();
    updatePageIndicator();
    buildThumbs();
    relayoutAfterPageChange();
    App.ui.toast(tr('toast.blankInserted'));
  }

  function setPageModel(model) {
    const state = S();
    const old = new Map(state.pages.map((p) => [p.id, p]));
    state.pages = model.map((m) => {
      const prev = old.get(m.id);
      if (prev) {
        const p = prev;
        p.src = m.src;
        p.rot = m.rot;
        p.baseW = m.baseW;
        p.baseH = m.baseH;
        const swapped = p.rot % 180 !== 0;
        p.wPt = swapped ? p.baseH : p.baseW;
        p.hPt = swapped ? p.baseW : p.baseH;
        p.rendered = false;
        p.textItems = null;
        cache.textContent.delete(p.id);
        return p;
      }
      return hydratePage(m);
    });
    buildDom();
    layout();
    buildThumbs();
  }

  /* ------------------------------- 目录：书签 ------------------------------- */
  async function buildOutline() {
    const box = el.outline;
    if (!box) return;
    const st = S();
    box.innerHTML = '';
    let items = null;
    try {
      items = st.pdfDoc ? await st.pdfDoc.getOutline() : null;
    } catch {
      items = null;
    }
    // 期间切换了标签页：丢弃，避免把旧文档的书签画到新标签页上
    if (S() !== st) return;
    st.outline = items && items.length ? items : null;
    if (!st.outline) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    const render = (list, level) => {
      for (const it of list) {
        const row = document.createElement('div');
        row.className = 'ol-item';
        row.style.paddingLeft = 12 + level * 12 + 'px';
        row.textContent = it.title;
        row.title = it.title;
        row.onclick = () => gotoOutline(it);
        box.appendChild(row);
        if (it.items && it.items.length) render(it.items, level + 1);
      }
    };
    render(st.outline, 0);
  }

  async function gotoOutline(item) {
    const st = S();
    try {
      let dest = item.dest;
      if (typeof dest === 'string') dest = await st.pdfDoc.getDestination(dest);
      if (!Array.isArray(dest) || !dest.length) return;
      const idx = await st.pdfDoc.getPageIndex(dest[0]);
      scrollToPage(idx);
    } catch (e) {
      /* 目标无效时忽略 */
    }
  }

  /* ------------------------------- 缩略图 ------------------------------- */
  function buildThumbs() {
    if (el.sidebar.classList.contains('hidden')) return;
    el.thumbs.innerHTML = '';
    S().pages.forEach((p, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'thumb';
      wrap.dataset.index = i;
      wrap.dataset.id = p.id;

      const box = document.createElement('div');
      box.className = 'thumb-box';
      const c = document.createElement('canvas');
      box.appendChild(c);
      wrap.appendChild(box);

      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = i + 1;
      wrap.appendChild(num);

      el.thumbs.appendChild(wrap);
      wrap.addEventListener('click', () => scrollToPage(i));
      renderThumb(p, c);
    });
    highlightThumb(S().currentPage);
  }

  async function renderThumb(p, canvas) {
    const targetW = 168;
    const scale = targetW / p.wPt;
    try {
      if (p.src == null) {
        canvas.width = Math.round(p.wPt * scale);
        canvas.height = Math.round(p.hPt * scale);
        const c = canvas.getContext('2d');
        c.fillStyle = '#fff';
        c.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }
      // 主画布已画好：直接缩放过来，既快又不会和主渲染抢同一页
      if (p.rendered && p.canvas.width > 1) {
        const w = Math.max(1, Math.round(p.wPt * scale));
        const h = Math.max(1, Math.round(p.hPt * scale));
        canvas.width = w;
        canvas.height = h;
        const c = canvas.getContext('2d', { alpha: false });
        c.fillStyle = '#fff';
        c.fillRect(0, 0, w, h);
        c.drawImage(p.canvas, 0, 0, w, h);
        return;
      }
      // 还没画过：等主渲染结束再单独渲染，避免并发导致缩略图变黑
      for (let i = 0; i < 40 && p.rendering; i++) await new Promise((r) => setTimeout(r, 60));
      const page = await getPage(p.src, S().pdfDoc);
      if (!page) return;
      const vp = page.getViewport({ scale, rotation: p.rot });
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch (e) {
      /* 忽略：缩略图失败不影响阅读 */
    }
  }

  function renderThumbIfOpen(p) {
    if (el.sidebar.classList.contains('hidden')) return;
    const wrap = el.thumbs.querySelector(`.thumb[data-id="${p.id}"]`);
    if (wrap) renderThumb(p, wrap.querySelector('canvas'));
  }

  function renderThumbsIfOpen() {
    if (!el.sidebar.classList.contains('hidden')) buildThumbs();
  }

  function highlightThumb(index) {
    let active = null;
    el.thumbs.querySelectorAll('.thumb').forEach((t) => {
      const on = Number(t.dataset.index) === index;
      t.classList.toggle('current', on);
      if (on) active = t;
    });
    if (active && el.thumbs.scrollHeight > el.thumbs.clientHeight) {
      const top = active.offsetTop - el.thumbs.clientHeight / 2 + active.offsetHeight / 2;
      el.thumbs.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  function toggleSidebar(show) {
    const visible = show === undefined ? el.sidebar.classList.contains('hidden') : show;
    el.sidebar.classList.toggle('hidden', !visible);
    if (visible) {
      buildThumbs();
      buildOutline();
    }
    requestAnimationFrame(() => {
      if (S().pdfDoc) onResize();
    });
    return visible;
  }

  function isSidebarOpen() {
    return el.sidebar && !el.sidebar.classList.contains('hidden');
  }

  /* -------------------------------- 搜索 -------------------------------- */
  let searchToken = 0;

  async function search(query) {
    const state = S();
    const token = ++searchToken;
    const local = [];
    if (!query || !state.pdfDoc) {
      state.search = { query: '', matches: [], index: -1 };
      refreshOverlays();
      return state.search;
    }
    const q = query.toLowerCase();
    for (let i = 0; i < state.pages.length; i++) {
      const p = state.pages[i];
      const items = await ensureTextItems(p);
      if (token !== searchToken) return state.search; // 已被更新的搜索取代
      for (const it of items) {
        const hay = it.str.toLowerCase();
        let from = 0;
        let idx;
        while ((idx = hay.indexOf(q, from)) >= 0) {
          const rects = [];
          // 按字符比例估算命中区域
          const len = it.str.length || 1;
          const x0 = it.left + (it.width * idx) / len;
          const x1 = it.left + (it.width * (idx + q.length)) / len;
          rects.push({
            x: x0 / (p.wPt * state.zoom),
            y: it.top / (p.hPt * state.zoom),
            w: (x1 - x0) / (p.wPt * state.zoom),
            h: (it.height * 1.15) / (p.hPt * state.zoom),
          });
          local.push({ pageId: p.id, pageIndex: i, rects });
          from = idx + Math.max(1, q.length);
        }
      }
    }
    if (token !== searchToken) return state.search;
    state.search = { query, matches: local, index: -1 };
    if (local.length) {
      state.search.index = 0;
      gotoSearcMatch(0);
    } else {
      refreshOverlays();
    }
    return state.search;
  }

  async function ensureTextItems(p) {
    if (p.textItems) return p.textItems;
    if (p.src == null) return [];
    const page = await getPage(p.src, S().pdfDoc);
    if (!page) return [];
    const viewport = page.getViewport({ scale: S().zoom, rotation: p.rot });
    let tc = cache.textContent.get(p.id);
    if (!tc) {
      const content = await page.getTextContent();
      tc = { items: content.items, styles: content.styles };
      cache.textContent.set(p.id, tc);
    }
    const items = [];
    for (const item of tc.items) {
      if (!item.str) continue;
      const style = tc.styles[item.fontName] || {};
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      const ascent = style.ascent > 0 ? style.ascent : 0.8;
      items.push({
        str: item.str,
        left: tx[4],
        top: tx[5] - fontHeight * ascent,
        width: item.width * viewport.scale,
        height: fontHeight,
        fontSize: fontHeight,
      });
    }
    p.textItems = items;
    return items;
  }

  function gotoSearcMatch(i) {
    const s = S().search;
    if (!s.matches.length) return;
    s.index = (i + s.matches.length) % s.matches.length;
    const m = s.matches[s.index];
    const p = S().pages[m.pageIndex];
    if (p && p.el) {
      const top = p.el.offsetTop + m.rects[0].y * p.el.offsetHeight - el.scroll.clientHeight * 0.32;
      el.scroll.scrollTo({ top, behavior: 'smooth' });
    }
    refreshOverlays();
    return s.index;
  }

  /* ------------------------------- 工具函数 ------------------------------- */
  function showLoading(text) {
    if (text) document.getElementById('loading-text').textContent = text;
    el.loading.classList.remove('hidden');
  }
  function hideLoading() {
    el.loading.classList.add('hidden');
  }

  function getEl() {
    return el;
  }

  /** 切换单页 / 双页视图（真正改变排版，不只是加个 class） */
  function setTwoUp(on) {
    const st = S();
    if (!st.pdfDoc) return false;
    st.twoUp = !!on;
    runZoomHooks();
    const a = captureAnchor();
    if (st.zoomMode === 'fitWidth' || st.zoomMode === 'fitPage' || st.zoomMode === 'auto') {
      computeAutoZoom();
    }
    layout();
    restoreAnchor(a);
    notifyZoom();
    return st.twoUp;
  }

  App.viewer = {
    init,
    createView,
    bindTab,
    destroyView,
    onScrollHook,
    onZoomHook,
    resumeView,
    isSidebarOpen,
    buildOutline,
    isLoading,
    load,
    layout,
    setZoom,
    zoomIn,
    zoomOut,
    zoomTo,
    zoomAt,
    animateZoom,
    setTwoUp,
    notifyZoom,
    fitWidth,
    fitPage,
    renderVisible,
    renderPage,
    refreshOverlays,
    updatePageIndicator,
    scrollToPage,
    getTextItems,
    ensureTextItems,
    rotatePage,
    deletePage,
    insertBlankPage,
    relayoutAfterPageChange,
    setPageModel,
    toggleSidebar,
    buildThumbs,
    renderThumbsIfOpen,
    search,
    gotoSearcMatch,
    showLoading,
    hideLoading,
    getEl,
    onResize,
  };
})();
