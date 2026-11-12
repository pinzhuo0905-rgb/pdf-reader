/* OCR 文字识别：把页面或框选区域渲染成位图，交给主进程的自研 OCR 引擎 */
(function () {
  const App = (window.App = window.App || {});
  const S = () => App.state;
  const $ = (id) => document.getElementById(id);

  const ui = { busy: false, selecting: false, sel: null, activeIndex: -1 };
  const PAGE_SCALE = 1.6; // 整页识别倍率（速度/精度平衡）
  const REGION_SCALE = 2.2; // 框选区域倍率（区域小，追求精度）

  function init() {
    $('ocr-close').onclick = close;
    $('ocr-run-page').onclick = () => runPage();
    $('ocr-run-region').onclick = startRegionSelect;
    $('ocr-copy-all').onclick = copyAll;
    $('ocr-insert').onclick = insertAsText;
    $('ocr-show-boxes').onchange = () => {
      if (S().ocr) S().ocr.visible = $('ocr-show-boxes').checked;
      App.viewer.refreshOverlays();
    };
    // 语言选项：读取上次选择
    const langSel = $('ocr-lang');
    window.api.getSettings().then((cfg) => {
      if (cfg && cfg.ocrLang && ['auto', 'ch', 'en'].includes(cfg.ocrLang)) {
        langSel.value = cfg.ocrLang;
      }
    });
    langSel.onchange = () => {
      window.api.setSettings({ ocrLang: langSel.value });
    };

    // 预加载模型（后台进行，不阻塞界面）
    window.api.ocrWarmup().then((r) => {
      if (r && !r.ok) console.warn('OCR 模型加载失败:', r.error);
    });
  }

  function open() {
    $('ocrPanel').classList.remove('hidden');
    renderList();
  }

  function close() {
    $('ocrPanel').classList.add('hidden');
    if (ui.selecting) {
      stopRegionSelect(); // 清掉监听器，否则关面板后点页面还会进入框选
      setStatus('把扫描页或图片中的文字识别为可复制的文本');
    }
  }

  function toggle() {
    if ($('ocrPanel').classList.contains('hidden')) open();
    else close();
  }

  function setStatus(text) {
    $('ocr-status').textContent = text;
  }

  function setBusy(b) {
    ui.busy = b;
    $('ocr-run-page').disabled = b;
    $('ocr-run-region').disabled = b;
  }

  /* --------------------------- 识别入口 --------------------------- */
  async function runPage() {
    const st = S();
    if (!st.pdfDoc) {
      App.ui.toast('请先打开 PDF 文件');
      return;
    }
    const page = st.pages[st.currentPage];
    if (!page) return;
    setBusy(true);
    setStatus('正在渲染页面…');
    try {
      const shot = await renderPageBitmap(page, PAGE_SCALE);
      // 整页识别：结果坐标系 = 页面归一化坐标系
      await recognize(shot, page, 0, 0, 1, 1);
    } catch (e) {
      console.error(e);
      setStatus('识别失败：' + (e.message || e));
    } finally {
      setBusy(false);
    }
  }

  /** 把页面（含已有标注）渲染成位图 */
  async function renderPageBitmap(page, scale) {
    const w = Math.max(1, Math.round(page.wPt * scale));
    const h = Math.max(1, Math.round(page.hPt * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    if (page.src != null) {
      const pdfPage = await S().pdfDoc.getPage(page.src + 1);
      const vp = pdfPage.getViewport({ scale, rotation: page.rot });
      await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
    }
    for (const a of App.annots.get(page.id)) App.annotate.paint(ctx, a, w, h, scale, true);
    return { canvas, width: w, height: h };
  }

  /* --------------------------- 框选区域 --------------------------- */
  function startRegionSelect() {
    if (!S().pdfDoc) {
      App.ui.toast('请先打开 PDF 文件');
      return;
    }
    if (ui.selecting) return;
    ui.selecting = true;
    $('main').classList.add('ocr-selecting');
    setStatus('在页面上拖拽框选要识别的区域…（Esc 取消）');
    window.addEventListener('pointerdown', onSelDown, true);
  }

  function stopRegionSelect() {
    ui.selecting = false;
    ui.sel = null;
    $('main').classList.remove('ocr-selecting');
    window.removeEventListener('pointerdown', onSelDown, true);
    window.removeEventListener('pointermove', onSelMove, true);
    window.removeEventListener('pointerup', onSelUp, true);
    clearRubber();
  }

  let rubber = null;
  function onSelDown(e) {
    if (!ui.selecting) return;
    const el = e.target.closest && e.target.closest('.page');
    if (!el) return;
    const page = S().pages.find((p) => p.el === el);
    if (!page) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    ui.sel = { page, rect, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    window.addEventListener('pointermove', onSelMove, true);
    window.addEventListener('pointerup', onSelUp, true);
    drawRubber();
  }

  function onSelMove(e) {
    if (!ui.sel) return;
    e.preventDefault();
    ui.sel.x1 = e.clientX;
    ui.sel.y1 = e.clientY;
    drawRubber();
  }

  async function onSelUp(e) {
    if (!ui.sel) return;
    const sel = ui.sel;
    sel.x1 = e.clientX;
    sel.y1 = e.clientY;
    window.removeEventListener('pointermove', onSelMove, true);
    window.removeEventListener('pointerup', onSelUp, true);
    clearRubber();

    const { page, rect } = sel;
    const nx = (Math.min(sel.x0, sel.x1) - rect.left) / rect.width;
    const ny = (Math.min(sel.y0, sel.y1) - rect.top) / rect.height;
    const nw = Math.abs(sel.x1 - sel.x0) / rect.width;
    const nh = Math.abs(sel.y1 - sel.y0) / rect.height;
    ui.sel = null;
    ui.selecting = false;
    $('main').classList.remove('ocr-selecting');
    window.removeEventListener('pointerdown', onSelDown, true);

    if (nw < 0.01 || nh < 0.005) {
      setStatus('选区太小，请重新框选');
      return;
    }
    setBusy(true);
    setStatus('正在识别选区…');
    try {
      const shot = await renderPageBitmap(page, REGION_SCALE);
      const sx = Math.max(0, Math.round(nx * shot.width));
      const sy = Math.max(0, Math.round(ny * shot.height));
      const sw = Math.max(1, Math.round(nw * shot.width));
      const sh = Math.max(1, Math.round(nh * shot.height));
      const crop = document.createElement('canvas');
      crop.width = sw;
      crop.height = sh;
      crop.getContext('2d').drawImage(shot.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      await recognize(
        { canvas: crop, width: sw, height: sh },
        page,
        sx / shot.width,
        sy / shot.height,
        sw / shot.width,
        sh / shot.height
      );
    } catch (err) {
      console.error(err);
      setStatus('识别失败：' + (err.message || err));
    } finally {
      setBusy(false);
    }
  }

  function drawRubber() {
    const sel = ui.sel;
    if (!sel) return;
    if (!rubber) {
      rubber = document.createElement('div');
      rubber.style.cssText =
        'position:fixed;border:1.5px solid #0072c9;background:rgba(0,114,201,.12);pointer-events:none;z-index:60;border-radius:2px;';
      document.body.appendChild(rubber);
    }
    const x = Math.min(sel.x0, sel.x1);
    const y = Math.min(sel.y0, sel.y1);
    rubber.style.left = x + 'px';
    rubber.style.top = y + 'px';
    rubber.style.width = Math.abs(sel.x1 - sel.x0) + 'px';
    rubber.style.height = Math.abs(sel.y1 - sel.y0) + 'px';
  }

  function clearRubber() {
    if (rubber && rubber.parentNode) rubber.parentNode.removeChild(rubber);
    rubber = null;
  }

  /* --------------------------- 调用引擎 --------------------------- */
  async function recognize(shot, page, offX, offY, spanW, spanH) {
    const st = S();
    setStatus('正在识别文字…');
    const ctx = shot.canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, shot.width, shot.height);
    const t0 = performance.now();
    const lang = $('ocr-lang').value || 'auto';
    const res = await window.api.ocrRecognize({
      width: shot.width,
      height: shot.height,
      data: imgData.data,
      lang,
    });
    if (!res || !res.ok) {
      setStatus('识别失败：' + ((res && res.error) || '未知错误'));
      return;
    }
    const lines = (res.lines || []).map((l) => {
      const xs = l.box.map((p) => p[0]);
      const ys = l.box.map((p) => p[1]);
      const x = Math.min(...xs) / shot.width;
      const y = Math.min(...ys) / shot.height;
      const w = (Math.max(...xs) - Math.min(...xs)) / shot.width;
      const h = (Math.max(...ys) - Math.min(...ys)) / shot.height;
      return {
        text: l.text,
        score: l.score,
        // 归一化到整页坐标
        x: offX + x * spanW,
        y: offY + y * spanH,
        w: w * spanW,
        h: h * spanH,
      };
    });
    // 识别期间切换了标签页：结果丢弃，避免写到别的标签页上
    if (S() !== st) return;
    st.ocr = { pageId: page.id, boxes: lines, visible: $('ocr-show-boxes').checked };
    ui.activeIndex = -1;
    renderList();
    App.viewer.refreshOverlays();
    const ms = res.ms || Math.round(performance.now() - t0);
    const modelName = res.lang === 'en' ? '英文模型' : '中文模型';
    setStatus(
      lines.length
        ? `识别完成：${lines.length} 行，${modelName}，用时 ${ms} ms（检测 ${res.detMs || 0} / 识别 ${res.recMs || 0}）`
        : '未识别到文字，可尝试框选更小的区域、提高清晰度或切换识别语言'
    );
  }

  /* --------------------------- 结果列表 --------------------------- */
  function renderList() {
    const list = $('ocr-list');
    const ocr = S().ocr;
    if (!ocr || !ocr.boxes.length) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = '';
    ocr.boxes.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'op-item' + (i === ui.activeIndex ? ' active' : '');
      const txt = document.createElement('div');
      txt.className = 'txt';
      txt.textContent = b.text;
      const sc = document.createElement('div');
      sc.className = 'sc';
      sc.textContent = Math.round(b.score * 100) + '%';
      row.appendChild(txt);
      row.appendChild(sc);
      row.onclick = () => {
        ui.activeIndex = i;
        renderList();
        scrollToBox(ocr.pageId, b);
      };
      row.ondblclick = () => {
        copyText(b.text);
      };
      list.appendChild(row);
    });
  }

  function scrollToBox(pageId, b) {
    const page = S().pages.find((p) => p.id === pageId);
    if (!page || !page.el) return;
    const el = App.viewer.getEl().scroll;
    const top = page.el.offsetTop + b.y * page.el.offsetHeight - el.clientHeight * 0.3;
    el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => App.ui.toast('已复制'),
        () => App.ui.toast('复制失败')
      );
    } else {
      App.ui.toast('复制失败');
    }
  }

  function copyAll() {
    const ocr = S().ocr;
    if (!ocr || !ocr.boxes.length) {
      App.ui.toast('还没有识别结果');
      return;
    }
    const text = ocr.boxes.map((b) => b.text).join('\n');
    copyText(text);
    App.ui.toast(`已复制 ${ocr.boxes.length} 行文本`);
  }

  /* --------------------------- 插入为文本框 --------------------------- */
  function insertAsText() {
    const st = S();
    const ocr = st.ocr;
    if (!ocr || !ocr.boxes.length) {
      App.ui.toast('还没有识别结果');
      return;
    }
    const page = st.pages.find((p) => p.id === ocr.pageId);
    if (!page) return;
    // 页面上已有可选文字层时提醒：插入的文本框会与原文字重叠（该功能主要面向扫描件）
    const items = App.viewer.getTextItems(page.id);
    if (items && items.length > 3) {
      App.ui.showModal(
        '插入文本框',
        '当前页已有可选择的文字层，插入的文本框会与原文字重叠。<br/>该功能通常用于扫描件或图片页。是否继续？',
        [
          { label: '取消' },
          { label: '继续插入', primary: true, onClick: () => doInsert(page, ocr) },
        ]
      );
      return;
    }
    doInsert(page, ocr);
  }

  function doInsert(page, ocr) {
    const H = page.hPt;
    for (const b of ocr.boxes) {
      App.annots.add(page.id, {
        type: 'text',
        x: b.x,
        y: b.y,
        w: Math.max(b.w, 0.05),
        h: Math.max(b.h * 1.2, 0.02),
        text: b.text,
        // 字号按框高换算成 pt，限制在合理范围
        size: Math.max(6, Math.min(48, b.h * H * 0.86)),
        color: '#1b1b1b',
        align: 'left',
      });
    }
    App.ui.toast(`已插入 ${ocr.boxes.length} 个文本框，Ctrl+S 保存到 PDF`);
  }

  App.ocr = { init, open, close, toggle, runPage, startRegionSelect, renderList };
})();
