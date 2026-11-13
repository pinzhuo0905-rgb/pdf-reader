/* 全功能自检：把基础功能与高级功能各跑一遍（部分多轮重复），暴露回归与不稳定点 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const assert = (k, ok, extra) => {
    out[k] = ok ? 'ok' : 'FAIL' + (extra === undefined ? '' : ' ' + JSON.stringify(extra));
  };
  const $ = (id) => document.getElementById(id);
  const S = () => App.state;

  // 运行时异常收集：静默抛错也要暴露出来
  const runtimeErrors = [];
  window.addEventListener('error', (e) => runtimeErrors.push(String((e && e.message) || e.error)));
  window.addEventListener('unhandledrejection', (e) =>
    runtimeErrors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason))
  );
  const zoom = () => S().zoom;
  const waitZoom = () => sleep(340); // 缩放动画 150ms + 兜底 260ms
  const activeView = () => $('views').querySelector('.view.active');
  const activePages = () => activeView() && activeView().querySelector('.pages');

  const fire = (el, type, props = {}) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...props }));
  const at = (page, nx, ny) => {
    const r = page.el.getBoundingClientRect();
    return { clientX: r.left + nx * r.width, clientY: r.top + ny * r.height };
  };
  const dragOn = async (page, x0, y0, x1, y1, steps = 4) => {
    fire(page.el, 'pointerdown', at(page, x0, y0));
    for (let i = 1; i <= steps; i++) {
      fire(page.el, 'pointermove', at(page, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps));
      await sleep(20);
    }
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    await sleep(140);
  };

  try {
    for (let i = 0; i < 150 && !S().pdfDoc; i++) await sleep(100);
    await sleep(900);

    let page = S().pages[0];
    assert('docLoaded', !!S().pdfDoc && S().pages.length > 0, S().pages.length);

    /* ==================== 1) 页码跳转 ==================== */
    const total = S().pages.length;
    $('page-input').value = String(Math.min(3, total));
    $('page-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(400);
    assert('pageJumpByInput', S().currentPage === Math.min(3, total) - 1, [S().currentPage, total]);
    App.viewer.scrollToPage(0, false);
    await sleep(300);

    /* ==================== 2) 缩放：按钮 5 轮 ==================== */
    const z0 = zoom();
    const zs = [];
    for (let i = 0; i < 5; i++) {
      App.viewer.zoomIn();
      await waitZoom();
      zs.push(zoom());
    }
    const monoUp = zs.every((z, i) => (i === 0 ? z > z0 : z > zs[i - 1]));
    assert('zoomIn5Rounds', monoUp, zs.map((z) => +z.toFixed(3)));

    const zs2 = [];
    for (let i = 0; i < 5; i++) {
      App.viewer.zoomOut();
      await waitZoom();
      zs2.push(zoom());
    }
    const monoDown = zs2.every((z, i) => (i === 0 ? z < zs[4] : z < zs2[i - 1]));
    assert('zoomOut5Rounds', monoDown, zs2.map((z) => +z.toFixed(3)));

    App.viewer.setZoom(99, 'custom');
    await waitZoom();
    const zMax = zoom();
    App.viewer.setZoom(0.01, 'custom');
    await waitZoom();
    const zMin = zoom();
    assert('zoomClamped', zMax <= 5.0001 && zMin >= 0.1499, [zMax, zMin]);

    App.viewer.fitWidth();
    await waitZoom();
    const area = activeView().querySelector('.scroll-area');
    const pw = S().pages[0].el.getBoundingClientRect().width;
    const ratio = pw / (area.clientWidth - 48 - 18);
    assert('fitWidth', ratio > 0.9 && ratio < 1.08, [+ratio.toFixed(3), Math.round(pw), area.clientWidth]);

    App.viewer.fitPage();
    await waitZoom();
    const ph = S().pages[0].el.getBoundingClientRect().height;
    assert('fitPage', ph <= area.clientHeight + 2, [Math.round(ph), area.clientHeight]);

    // 滑块 150%
    const range = $('zoom-range');
    range.value = '150';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await waitZoom();
    assert('slider150', Math.abs(zoom() - 1.5) < 0.02, zoom());
    range.dispatchEvent(new Event('change', { bubbles: true }));

    /* ==================== 3) 双页视图 + 页面操作 ==================== */
    App.viewer.setZoom(0.7, 'custom');
    await waitZoom();
    $('btn-viewmode').click();
    await sleep(450);
    const rowOf = (i) => Math.round(S().pages[i].el.offsetTop);
    assert('twoUpOn', activePages().classList.contains('two-up') && Math.abs(rowOf(0) - rowOf(1)) <= 2, [rowOf(0), rowOf(1)]);
    assert('twoUpWidth', parseInt(activePages().style.width, 10) > 0, activePages().style.width);

    // 双页下旋转：容器宽度应重算，仍两页一行
    App.viewer.rotatePage(0, 90);
    await sleep(600);
    const wAfterRotate = parseInt(activePages().style.width, 10);
    assert('twoUpRotateRelayout', wAfterRotate > 0 && Math.abs(rowOf(0) - rowOf(1)) <= 2, [wAfterRotate, rowOf(0), rowOf(1)]);

    // 撤销旋转：应回到 0°，且双页布局跟着复原
    App.history.undo();
    await sleep(600);
    assert('undoRotate', S().pages[0].rot === 0, S().pages[0].rot);
    assert('undoRotateRelayout', Math.abs(rowOf(0) - rowOf(1)) <= 2, [rowOf(0), rowOf(1)]);

    // 双页下插入空白页
    const nBefore = S().pages.length;
    App.viewer.insertBlankPage(0);
    await sleep(600);
    assert('twoUpInsertPage', S().pages.length === nBefore + 1, [nBefore, S().pages.length]);
    assert('twoUpInsertWidth', parseInt(activePages().style.width, 10) > 0, activePages().style.width);
    App.history.undo();
    await sleep(600);

    // 双页下删除页
    const nDel = S().pages.length;
    App.viewer.deletePage(0);
    await sleep(600);
    assert('twoUpDeletePage', S().pages.length === nDel - 1, [nDel, S().pages.length]);
    assert('twoUpDeleteRelayout', parseInt(activePages().style.width, 10) > 0, activePages().style.width);
    App.history.undo();
    await sleep(600);

    $('btn-viewmode').click();
    await sleep(400);
    assert('twoUpOff', !activePages().classList.contains('two-up') && !activePages().style.width, activePages().style.width);
    App.viewer.setZoom(1, 'custom');
    await waitZoom();

    /* ==================== 4) 侧栏：目录 / 缩略图 ==================== */
    App.viewer.toggleSidebar(true);
    await sleep(700);
    const thumbs = $('thumbs').querySelectorAll('.thumb');
    assert('sidebarThumbs', thumbs.length === S().pages.length, [thumbs.length, S().pages.length]);
    if (thumbs.length > 1) {
      thumbs[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      thumbs[1].click();
      await sleep(500);
      assert('thumbJump', S().currentPage === 1, S().currentPage);
    }
    App.viewer.toggleSidebar(false);
    await sleep(250);

    /* ==================== 5) 搜索 ==================== */
    const res = await App.viewer.search('the');
    await sleep(300);
    assert('searchHits', res.matches.length > 0, res.matches.length);
    const i1 = App.viewer.gotoSearcMatch(1);
    await sleep(250);
    assert('searchNext', i1 === 1, i1);
    const iWrap = App.viewer.gotoSearcMatch(res.matches.length);
    assert('searchWrap', iWrap === 0, iWrap);
    App.viewer.search('');
    await sleep(150);

    /* ==================== 6) 标注：多轮重复 ==================== */
    page = S().pages[0];
    const annotCount = (type) => App.annots.get(page.id).filter((a) => a.type === type).length;

    App.ui.setTool('highlight');
    for (let i = 0; i < 3; i++) {
      const y = 0.1 + i * 0.05;
      await dragOn(page, 0.1, y, 0.45, y + 0.02, 2);
    }
    assert('highlight3', annotCount('highlight') === 3, annotCount('highlight'));

    App.ui.setTool('draw');
    for (let i = 0; i < 2; i++) {
      const y = 0.4 + i * 0.05;
      await dragOn(page, 0.15, y, 0.5, y + 0.02, 4);
    }
    assert('ink2', annotCount('ink') === 2, annotCount('ink'));

    // 橡皮：擦笔画中点，应断成两段
    App.ui.setTool('eraser');
    const ink = App.annots.get(page.id).find((a) => a.type === 'ink');
    const mid = ink.points[Math.floor(ink.points.length / 2)];
    const pt = at(page, mid.x, mid.y);
    fire(page.el, 'pointerdown', pt);
    await sleep(120);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    await sleep(300);
    assert('eraserSplits', annotCount('ink') === 3, annotCount('ink'));

    // 形状 4 种
    for (const kind of ['rect', 'ellipse', 'line', 'arrow']) {
      S().opts.shapeKind = kind;
      App.ui.setTool('shape');
      await dragOn(page, 0.2, 0.6, 0.35, 0.7, 3);
    }
    assert('shapes4', annotCount('shape') === 4, annotCount('shape'));

    // 涂改
    App.ui.setTool('whiteout');
    await dragOn(page, 0.55, 0.6, 0.7, 0.68, 2);
    assert('whiteout', annotCount('whiteout') === 1, annotCount('whiteout'));

    // 文本框：页内编辑 → 提交
    App.ui.setTool('textbox');
    App.annotate.openTextCreator(page, 0.5, 0.25);
    await sleep(250);
    assert('textboxEditorOpen', !!$('textEditor') && $('textEditor').parentElement === page.el);
    $('textEditorInput').value = '功能自检文本';
    App.textedit.commit();
    await sleep(300);
    assert('textboxCreated', annotCount('text') === 1, annotCount('text'));

    // 撤销 / 重做 6 轮，快照应完全一致
    const snapA = App.history.snapshot();
    for (let i = 0; i < 6; i++) {
      App.history.undo();
      await sleep(60);
    }
    const afterUndo = App.history.snapshot();
    for (let i = 0; i < 6; i++) {
      App.history.redo();
      await sleep(60);
    }
    const afterRedo = App.history.snapshot();
    assert('undoRedo6', afterRedo === snapA && afterUndo !== snapA, { same: afterRedo === snapA, changed: afterUndo !== snapA });

    /* ==================== 7) 编辑文字（页内原地） ==================== */
    App.ui.setTool('textedit');
    await App.viewer.ensureTextItems(page);
    const items = App.viewer.getTextItems(page.id);
    const it = items.find((x) => x.str && x.str.trim().length > 5);
    if (it) {
      const c = at(page, (it.left + it.width / 2) / (page.wPt * zoom()), (it.top + it.height / 2) / (page.hPt * zoom()));
      fire(page.el, 'pointerdown', c);
      await sleep(300);
      const ed = $('textEditor');
      assert('texteditInline', !!ed && ed.parentElement === page.el);
      if (ed) {
        $('textEditorInput').value = '原地改写 OK';
        App.textedit.commit();
        await sleep(300);
        assert('texteditWritten', annotCount('textedit') === 1, annotCount('textedit'));
        App.history.undo();
        await sleep(250);
      }
    } else {
      assert('texteditInline', false, 'no text items');
    }

    /* ==================== 8) 导出 / 保存构建 ==================== */
    const bytes = await App.exporter.build();
    assert('exportBytes', bytes && bytes.length > 1000, bytes && bytes.length);
    try {
      const doc = await PDFLib.PDFDocument.load(bytes);
      assert('exportPageCount', doc.getPageCount() === S().pages.length, [doc.getPageCount(), S().pages.length]);
    } catch (e) {
      assert('exportPageCount', false, String(e && e.message));
    }

    /* ==================== 9) 多标签 ==================== */
    const t1 = App.tabs.active();
    App.tabs.createBlank(true);
    await sleep(500);
    assert('tabCreated', App.tabs.list.length === 2, { n: App.tabs.list.length, names: App.tabs.list.map((x) => x.state.fileName) });
    // 空白标签页：依赖文档的控件（含缩放滑块）应禁用
    assert('blankTabDisablesZoom', $('zoom-range').disabled === true && $('btn-viewmode').disabled === true);
    App.tabs.activate(t1.id);
    await sleep(500);
    assert('tabSwitchedBack', App.tabs.active().id === t1.id, App.tabs.active() && App.tabs.active().id);
    assert('tabDocIntact', S().pages.length > 0 && !!S().pdfDoc);
    assert('docTabEnablesZoom', $('zoom-range').disabled === false && $('btn-viewmode').disabled === false);
    const t2 = App.tabs.list.find((x) => x.id !== t1.id);
    App.tabs.close(t2.id, true);
    await sleep(400);
    assert('tabClosed', App.tabs.list.length === 1, App.tabs.list.length);

    /* ==================== 9.5) 图片 / 右键菜单 / 复制 / OCR 面板 ==================== */
    // 图片标注：用一张 1x1 PNG，验证能画、能导出
    // 用真实的 PNG（应用图标）而不是 1x1 占位图，贴近用户插入图片的真实路径
    const PNG = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth;
        c.height = im.naturalHeight;
        c.getContext('2d').drawImage(im, 0, 0);
        resolve(c.toDataURL('image/png'));
      };
      im.onerror = () => reject(new Error('icon load failed'));
      im.src = 'assets/pdf-icon-256.png';
    });

    // 采样导出结果里图片区域的平���颜色：有图片时应该和空白时不同
    const sampleRegion = async (bytes) => {
      const doc2 = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      const pg2 = await doc2.getPage(1);
      const vp2 = pg2.getViewport({ scale: 1 });
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(vp2.width);
      cv.height = Math.ceil(vp2.height);
      const c2 = cv.getContext('2d');
      c2.fillStyle = '#fff';
      c2.fillRect(0, 0, cv.width, cv.height);
      await pg2.render({ canvasContext: c2, viewport: vp2 }).promise;
      const cx = Math.round((0.1 + 0.06) * cv.width);
      const cy = Math.round((0.1 + 0.06) * cv.height);
      const d = c2.getImageData(Math.max(0, cx - 4), Math.max(0, cy - 4), 8, 8).data;
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
      return [r / n, g / n, b / n];
    };

    const bytesPlain = await App.exporter.build();
    const pxPlain = await sampleRegion(bytesPlain);

    const imgAnnot = App.annots.add(page.id, { type: 'image', x: 0.1, y: 0.1, w: 0.12, h: 0.12, data: PNG });
    await sleep(250);
    let imgExportOk = true;
    let pxWith = pxPlain;
    try {
      const b2 = await App.exporter.build();
      const d2 = await PDFLib.PDFDocument.load(b2);
      imgExportOk = d2.getPageCount() === S().pages.length;
      pxWith = await sampleRegion(b2);
    } catch (e) {
      imgExportOk = false;
    }
    const diff = Math.abs(pxWith[0] - pxPlain[0]) + Math.abs(pxWith[1] - pxPlain[1]) + Math.abs(pxWith[2] - pxPlain[2]);
    assert('imageAnnotExport', !!imgAnnot && imgExportOk);
    assert('imageAnnotDrawn', diff > 12, { plain: pxPlain.map(Math.round), withImg: pxWith.map(Math.round), diff: Math.round(diff) });
    App.annots.remove(page.id, imgAnnot.id);
    await sleep(150);

    // 标注右键菜单
    const anyAnnot = App.annots.get(page.id).find((a) => a.type === 'whiteout');
    if (anyAnnot) {
      const bb = App.annotate.bbox(anyAnnot);
      const ap = at(page, bb.x + bb.w / 2, bb.y + bb.h / 2);
      page.el.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ap.clientX, clientY: ap.clientY })
      );
      await sleep(200);
      const ctx = $('ctxMenu');
      const items = ctx.querySelectorAll('.menu-item');
      assert('annotCtxMenu', !ctx.classList.contains('hidden') && items.length >= 2, items.length);
      ctx.classList.add('hidden');
      S().selected = null;
      App.viewer.refreshOverlays();
    } else {
      assert('annotCtxMenu', false, 'no annot');
    }

    // 标签右键菜单
    const tabEl = document.querySelector('#tabstrip .tab');
    tabEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 20 }));
    await sleep(200);
    const tabCtxItems = $('ctxMenu').querySelectorAll('.menu-item');
    assert('tabCtxMenu', tabCtxItems.length >= 3, tabCtxItems.length);
    $('ctxMenu').classList.add('hidden');

    // 复制 / 全选
    App.ui.selectAllText();
    await sleep(150);
    const selText = String(window.getSelection().toString() || '');
    assert('selectAllText', selText.trim().length > 10, selText.length);
    const copied = App.ui.copySelection();
    assert('copySelection', copied === true);
    window.getSelection().removeAllRanges();

    // OCR 面板开关
    App.ocr.toggle();
    await sleep(150);
    const ocrOpen = !$('ocrPanel').classList.contains('hidden');
    App.ocr.toggle();
    await sleep(150);
    assert('ocrPanelToggle', ocrOpen && $('ocrPanel').classList.contains('hidden'), ocrOpen);

    /* ==================== 10) 主题 / 语言 ==================== */
    App.ui.applyTheme('dark');
    await sleep(120);
    assert('themeDark', $('app').classList.contains('theme-dark'));
    App.ui.applyTheme('light');
    await sleep(120);
    assert('themeLight', $('app').classList.contains('theme-light'));
    App.i18n.setLang('en', { silent: true });
    await sleep(150);
    assert('langEn', $('btn-save').title.startsWith('Save'), $('btn-save').title);
    App.i18n.setLang('zh', { silent: true });
    await sleep(150);
    assert('langZh', $('btn-save').title.startsWith('保存'), $('btn-save').title);

    /* ==================== 11) 稳定性：20 轮混合操作 ==================== */
    const before = S().pages.length;
    let err = null;
    try {
      for (let i = 0; i < 20; i++) {
        App.viewer.zoomIn();
        await sleep(30);
        App.viewer.zoomOut();
        await sleep(30);
        App.viewer.scrollToPage(i % S().pages.length, false);
        await sleep(20);
      }
      await sleep(600);
    } catch (e) {
      err = String(e && e.message);
    }
    assert('stress20NoError', !err, err);
    assert('stressPageCount', S().pages.length === before, [before, S().pages.length]);
    assert('stressZoomInRange', zoom() >= 0.15 && zoom() <= 5, zoom());
    assert(
      'stressDomConsistent',
      activeView().querySelectorAll('.page').length === S().pages.length,
      [activeView().querySelectorAll('.page').length, S().pages.length]
    );
    assert('stressTransformCleared', !activePages().style.transform, activePages().style.transform);

    const realErrors = runtimeErrors.filter(
      (m) => !/RenderingCancelled|network service|GPU process|Clipboard/i.test(m)
    );
    assert('noRuntimeErrors', realErrors.length === 0, realErrors.slice(0, 3));

    const failed = Object.entries(out).filter(([, v]) => String(v).startsWith('FAIL'));
    out.result = failed.length ? 'FAILED: ' + failed.map(([k]) => k).join(',') : 'ALL PASS';
    return out;
  } catch (e) {
    return { error: String(e), stack: ((e && e.stack) || '').split('\n').slice(0, 4).join(' | '), out };
  }
})();
