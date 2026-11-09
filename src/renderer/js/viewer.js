/* PDF 渲染视图：加载、布局、缩放、懒渲染、文本层、搜索、页面操作 */
(function () {
  const App = (window.App = window.App || {});
  const S = () => App.state;

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  const el = {};
  const cache = {
    textContent: new Map(), // pageId -> {items, styles}
    pageObj: new Map(), // src index -> pdfjs page
  };

  const PAD_X = 24;

  /* ------------------------------- 初始化 ------------------------------- */
  function init() {
    el.scroll = document.getElementById('scrollArea');
    el.pages = document.getElementById('pages');
    el.main = document.getElementById('main');
    el.pageInput = document.getElementById('page-input');
    el.pageTotal = document.getElementById('page-total');
    el.floatPage = document.getElementById('float-page');
    el.thumbs = document.getElementById('thumbs');
    el.sidebar = document.getElementById('sidebar');
    el.loading = document.getElementById('loading');
    el.empty = document.getElementById('empty');

    el.scroll.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    setupObserver();
  }

  /* -------------------------------- 加载 -------------------------------- */
  async function load(bytes, filePath, fileName) {
    showLoading('正在打开…');
    const state = S();
    state.bytes = bytes;
    state.filePath = filePath;
    state.fileName = fileName || (filePath ? filePath.split(/[\\/]/).pop() : '未命名.pdf');
    cache.textContent.clear();
    cache.pageObj.clear();
    state.annots = new Map();
    state.ocr = null;
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
      App.ui.toast('无法打开该 PDF：' + (err && err.message ? err.message : err));
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

    // 初始缩放
    computeAutoZoom();
    buildDom();
    App.history.reset();
    state.dirty = false;
    hideLoading();
    el.empty.classList.add('hidden');
    el.pages.classList.remove('hidden');
    updatePageIndicator();
    App.ui.setTitle();
    App.ui.setDocState(true);
    requestAnimationFrame(() => {
      layout();
      scrollToPage(0, false);
    });
    return true;
  }

  function hydratePage(m) {
    const rot = ((m.rot % 360) + 360) % 360;
    const swapped = rot % 180 !== 0;
    return {
      ...m,
      rot,
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

  async function getPage(srcIndex) {
    if (cache.pageObj.has(srcIndex)) return cache.pageObj.get(srcIndex);
    const page = await S().pdfDoc.getPage(srcIndex + 1);
    cache.pageObj.set(srcIndex, page);
    return page;
  }

  /* ------------------------------ 缩放计算 ------------------------------ */
  function computeAutoZoom() {
    const state = S();
    const first = state.pages[0];
    if (!first) return;
    const availW = el.scroll.clientWidth - PAD_X * 2 - 18;
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

  function setZoom(z, mode) {
    const state = S();
    state.zoom = Math.max(0.15, Math.min(5, z));
    if (mode) state.zoomMode = mode;
    const anchor = captureAnchor();
    layout();
    restoreAnchor(anchor);
    App.ui.updateZoomLabel();
  }

  function zoomIn() {
    const s = S();
    setZoom(s.zoom * 1.15, 'custom');
  }
  function zoomOut() {
    const s = S();
    setZoom(s.zoom / 1.15, 'custom');
  }
  function fitWidth() {
    S().zoomMode = 'fitWidth';
    computeAutoZoom();
    setZoom(S().zoom, 'fitWidth');
  }
  function fitPage() {
    S().zoomMode = 'fitPage';
    computeAutoZoom();
    setZoom(S().zoom, 'fitPage');
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
    for (const p of S().pages) {
      if (!p.el) continue;
      p.el.style.width = p.wPt * z + 'px';
      p.el.style.height = p.hPt * z + 'px';
      sizeOverlay(p);
      p.rendered = false; // 尺寸变化后需重绘
    }
    renderVisible(true);
  }

  function sizeOverlay(p) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(p.wPt * S().zoom));
    const h = Math.max(1, Math.round(p.hPt * S().zoom));
    p.overlay.width = Math.round(w * dpr);
    p.overlay.height = Math.round(h * dpr);
  }

  /* ------------------------------ 懒渲染 ------------------------------ */
  let observer = null;
  function setupObserver() {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) renderPage(e.target.dataset.id);
        }
      },
      { root: el.scroll, rootMargin: '600px 0px' }
    );
  }

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
    const p = S().pages.find((x) => x.id === pageId);
    if (!p || p.rendering || p.src == null) return;
    if (p.rendered && p._lastZoom === S().zoom) return;
    p.rendering = true;
    p._lastZoom = S().zoom;
    const dpr = window.devicePixelRatio || 1;
    try {
      const page = await getPage(p.src);
      const viewport = page.getViewport({ scale: S().zoom * dpr, rotation: p.rot });
      const canvas = p.canvas;
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.style.width = p.wPt * S().zoom + 'px';
      canvas.style.height = p.hPt * S().zoom + 'px';
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const task = page.render({ canvasContext: ctx, viewport });
      await task.promise;
      p.rendered = true;
      p.el.classList.remove('loading');
      await buildTextLayer(p, page);
      drawOverlay(p);
      renderThumbIfOpen(p);
    } catch (err) {
      if (err && err.name !== 'RenderingCancelledException') console.warn('render fail', err);
    } finally {
      p.rendering = false;
    }
  }

  /* ------------------------------- 文本层 ------------------------------- */
  async function buildTextLayer(p, page) {
    const viewport = page.getViewport({ scale: S().zoom, rotation: p.rot });
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

    // 选中框
    if (S().selected && S().selected.pageId === p.id) {
      const a = App.annots.find(p.id, S().selected.annotId);
      if (a) {
        const b = App.annotate.bbox(a);
        ctx.save();
        ctx.strokeStyle = '#0072c9';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(b.x * w, b.y * h, b.w * w, b.h * h);
        ctx.restore();
      }
    }
  }

  function refreshOverlays() {
    for (const p of S().pages) if (p.overlay && p.rendered) drawOverlay(p);
  }

  function getPageEl(pageId) {
    return S().pages.find((x) => x.id === pageId) || null;
  }

  /* ------------------------------ 滚动与页码 ------------------------------ */
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
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

  function onResize() {
    if (!S().pdfDoc) return;
    if (S().zoomMode === 'fitWidth' || S().zoomMode === 'fitPage' || S().zoomMode === 'auto') {
      const a = captureAnchor();
      computeAutoZoom();
      layout();
      restoreAnchor(a);
      App.ui.updateZoomLabel();
    }
  }

  /* ------------------------------ 页面操作 ------------------------------ */
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
    // 重建该页 DOM 尺寸
    p.el.style.width = p.wPt * state.zoom + 'px';
    p.el.style.height = p.hPt * state.zoom + 'px';
    sizeOverlay(p);
    state.dirty = true;
    App.history.push();
    renderPage(p.id);
    renderThumbIfOpen(p);
    App.ui.toast(`第 ${index + 1} 页已旋转`);
  }

  function deletePage(index) {
    const state = S();
    if (state.pages.length <= 1) {
      App.ui.toast('至少需要保留一页');
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
    App.ui.toast(`已删除第 ${index + 1} 页`);
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
    const after = state.pages[index + 1];
    const div = createPageEl(p);
    if (after && after.el && after.el.nextSibling) {
      el.pages.insertBefore(div, after.el.nextSibling);
    }
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
    App.ui.toast('已插入空白页');
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

  /* ------------------------------- 缩略图 ------------------------------- */
  function buildThumbs() {
    if (el.sidebar.classList.contains('hidden')) return;
    el.thumbs.innerHTML = '';
    const dpr = window.devicePixelRatio || 1;
    S().pages.forEach((p, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'thumb';
      wrap.dataset.index = i;
      wrap.dataset.id = p.id;
      const c = document.createElement('canvas');
      wrap.appendChild(c);
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
    const dpr = window.devicePixelRatio || 1;
    const targetW = 160;
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
      const page = await getPage(p.src);
      const vp = page.getViewport({ scale, rotation: p.rot });
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch (e) {
      /* 忽略 */
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
    el.thumbs.querySelectorAll('.thumb').forEach((t) => {
      t.classList.toggle('current', Number(t.dataset.index) === index);
    });
  }

  function toggleSidebar(show) {
    const visible = show === undefined ? el.sidebar.classList.contains('hidden') : show;
    el.sidebar.classList.toggle('hidden', !visible);
    if (visible) buildThumbs();
    requestAnimationFrame(() => {
      if (S().pdfDoc) onResize();
    });
    return visible;
  }

  /* -------------------------------- 搜索 -------------------------------- */
  async function search(query) {
    const state = S();
    state.search = { query, matches: [], index: -1 };
    if (!query || !state.pdfDoc) {
      refreshOverlays();
      return state.search;
    }
    const q = query.toLowerCase();
    for (let i = 0; i < state.pages.length; i++) {
      const p = state.pages[i];
      const items = await ensureTextItems(p);
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
          state.search.matches.push({ pageId: p.id, pageIndex: i, rects });
          from = idx + Math.max(1, q.length);
        }
      }
    }
    if (state.search.matches.length) {
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
    const page = await getPage(p.src);
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

  App.viewer = {
    init,
    load,
    layout,
    setZoom,
    zoomIn,
    zoomOut,
    fitWidth,
    fitPage,
    renderVisible,
    renderPage,
    refreshOverlays,
    updatePageIndicator,
    scrollToPage,
    getPageEl,
    getTextItems,
    ensureTextItems,
    rotatePage,
    deletePage,
    insertBlankPage,
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
