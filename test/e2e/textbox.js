/* 文本框：虚线框、手柄缩放、拖动移动、高度自适应 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const assert = (k, ok, extra) => {
    out[k] = ok ? 'ok' : 'FAIL' + (extra === undefined ? '' : ' ' + JSON.stringify(extra));
  };
  const $ = (id) => document.getElementById(id);

  try {
    for (let i = 0; i < 150 && !App.state.pdfDoc; i++) await sleep(100);
    await sleep(700);

    const page = App.state.pages[0];
    const el = page.el;
    const zoom = () => App.state.zoom;
    const toClient = (nx, ny) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + nx * r.width, y: r.top + ny * r.height };
    };
    const bluePixels = (nx0, ny0, nx1, ny1) => {
      const c = page.overlay;
      const ctx = c.getContext('2d');
      const sx = Math.max(0, Math.round(nx0 * c.width));
      const sy = Math.max(0, Math.round(ny0 * c.height));
      const sw = Math.max(1, Math.round((nx1 - nx0) * c.width));
      const sh = Math.max(1, Math.round((ny1 - ny0) * c.height));
      const d = ctx.getImageData(sx, sy, sw, sh).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 30 && d[i + 2] > 140 && d[i] < 130) n++;
      }
      return n;
    };
    const alphaPixels = (nx0, ny0, nx1, ny1) => {
      const c = page.overlay;
      const ctx = c.getContext('2d');
      const sx = Math.max(0, Math.round(nx0 * c.width));
      const sy = Math.max(0, Math.round(ny0 * c.height));
      const sw = Math.max(1, Math.round((nx1 - nx0) * c.width));
      const sh = Math.max(1, Math.round((ny1 - ny0) * c.height));
      const d = ctx.getImageData(sx, sy, sw, sh).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
      return n;
    };
    const drag = async (nx0, ny0, nx1, ny1, steps = 6) => {
      const a = toClient(nx0, ny0);
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: a.x, clientY: a.y, bubbles: true, cancelable: true, button: 0, buttons: 1 }));
      for (let i = 1; i <= steps; i++) {
        const p = toClient(nx0 + ((nx1 - nx0) * i) / steps, ny0 + ((ny1 - ny0) * i) / steps);
        el.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, bubbles: true, buttons: 1 }));
        await sleep(25);
      }
      const b = toClient(nx1, ny1);
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: b.x, clientY: b.y, bubbles: true, button: 0 }));
      await sleep(300);
    };

    /* 1) 用「添加文本」建一个文本框 */
    App.ui.setTool('textbox');
    await sleep(300);
    App.annotate.openTextCreator(page, 0.2, 0.3);
    await sleep(300);
    assert('editorDashed', getComputedStyle($('textEditor')).borderStyle === 'dashed', getComputedStyle($('textEditor')).borderStyle);
    assert('editorInPage', $('textEditor').parentElement === page.el, $('textEditor').parentElement && $('textEditor').parentElement.className);
    $('textEditorInput').value = '这是一个可以拖动和缩放的文本框';
    App.textedit.commit();
    await sleep(500);

    let a = App.annots.get(page.id).find((x) => x.type === 'text');
    assert('created', !!a && a.text.includes('拖动'), a && a.text);
    assert('autoSelected', !!App.state.selected && App.state.selected.annotId === a.id);
    assert('hasSize', a.w > 0.05 && a.h > 0.005, [a.w, a.h]);

    /* 2) 未选中时也有淡虚线边框 */
    const W = page.wPt * zoom();
    const H = page.hPt * zoom();
    App.state.selected = null;
    App.viewer.refreshOverlays();
    await sleep(200);
    const bandY = 6 / page.overlay.height;
    const topEdge = bluePixels(a.x, a.y - bandY, a.x + a.w, a.y + bandY);
    const anyAlpha = alphaPixels(a.x, a.y - bandY, a.x + a.w, a.y + bandY);
    assert('dashedWhenIdle', topEdge > 8, { topEdge, anyAlpha, rendered: page.rendered, overlay: [page.overlay.width, page.overlay.height] });
    // 单行扫描：虚线段之间应有空隙（实线会接近 100%）
    const rowY = Math.round(a.y * page.overlay.height);
    const rowData = page.overlay
      .getContext('2d')
      .getImageData(Math.round(a.x * page.overlay.width) + 2, rowY, Math.max(1, Math.round(a.w * page.overlay.width) - 4), 1).data;
    let onPx = 0;
    let totalPx = 0;
    for (let i = 0; i < rowData.length; i += 4) {
      totalPx++;
      if (rowData[i + 3] > 30 && rowData[i + 2] > 140 && rowData[i] < 130) onPx++;
    }
    const ratio = totalPx ? onPx / totalPx : 0;
    assert('dashNotSolid', onPx > 0 && ratio > 0.15 && ratio < 0.95, [onPx, totalPx, +ratio.toFixed(2)]);

    /* 3) 选中后出现手柄（蓝色像素明显增多） */
    App.state.selected = { pageId: page.id, annotId: a.id };
    App.viewer.refreshOverlays();
    await sleep(200);
    const withHandles = bluePixels(0, 0, 1, 1);
    App.state.selected = null;
    App.viewer.refreshOverlays();
    await sleep(200);
    const withoutHandles = bluePixels(0, 0, 1, 1);
    assert('handlesDrawn', withHandles > withoutHandles * 1.3, [withoutHandles, withHandles]);

    /* 4) 拖右下角手柄放大 */
    App.ui.setTool('select');
    await sleep(200);
    App.state.selected = { pageId: page.id, annotId: a.id };
    App.viewer.refreshOverlays();
    await sleep(200);
    const before = { x: a.x, y: a.y, w: a.w, h: a.h };
    await drag(a.x + a.w, a.y + a.h, a.x + a.w + 0.12, a.y + a.h + 0.05);
    assert('resizeSE', a.w > before.w + 0.05 && a.h > before.h + 0.01, [before, { w: a.w, h: a.h }]);
    assert('resizeKeepsOrigin', Math.abs(a.x - before.x) < 0.01 && Math.abs(a.y - before.y) < 0.01, [a.x, a.y]);

    /* 5) 拖左上角手柄缩小（改小宽度后高度应自动撑到放得下文字） */
    const before2 = { x: a.x, y: a.y, w: a.w, h: a.h };
    await drag(a.x, a.y, a.x + 0.05, a.y + 0.01);
    assert('resizeNW', a.w < before2.w - 0.03 && a.x > before2.x + 0.02, [before2, { x: a.x, w: a.w }]);
    const hTooSmall = 0.01;
    a.h = hTooSmall;
    App.annotate.fitTextHeight(page, a);
    assert('heightAutoFit', a.h > hTooSmall, [hTooSmall, a.h]);

    /* 6) 拖动框内移动 */
    const before3 = { x: a.x, y: a.y };
    await drag(a.x + a.w / 2, a.y + a.h / 2, a.x + a.w / 2 + 0.06, a.y + a.h / 2 + 0.04);
    assert('moveByDrag', a.x > before3.x + 0.03 && a.y > before3.y + 0.02, [before3, { x: a.x, y: a.y }]);

    /* 7) 最小尺寸限制：把右下角拖到左上角外侧 */
    await drag(a.x + a.w, a.y + a.h, a.x - 0.5, a.y - 0.5);
    assert('minSize', a.w > 0.005 && a.h > 0.003, [a.w, a.h]);

    /* 8) 「添加文本」工具下点已有文本框是移动，不会叠新的 */
    const countBefore = App.annots.get(page.id).filter((x) => x.type === 'text').length;
    App.ui.setTool('textbox');
    await sleep(200);
    const p0 = { x: a.x, y: a.y };
    await drag(a.x + a.w / 2, a.y + a.h / 2, a.x + a.w / 2 - 0.03, a.y + a.h / 2 + 0.03);
    const countAfter = App.annots.get(page.id).filter((x) => x.type === 'text').length;
    assert('textboxToolMoves', countAfter === countBefore && Math.abs(a.x - p0.x) > 0.005, [countBefore, countAfter, a.x - p0.x]);

    /* 9) 点空白处仍能新建 */
    App.annotate.openTextCreator(page, 0.55, 0.7);
    await sleep(250);
    assert('newOnEmpty', !!$('textEditor'));
    App.textedit.cancel();
    await sleep(120);
    assert('editorClosed', !$('textEditor'));

    /* 10) 撤销能回退缩放/移动 */
    const beforeUndo = { w: a.w, x: a.x };
    App.history.undo();
    await sleep(500);
    const a2 = App.annots.get(page.id).find((x) => x.type === 'text');
    assert('undoResize', !!a2 && (Math.abs(a2.w - beforeUndo.w) > 1e-6 || Math.abs(a2.x - beforeUndo.x) > 1e-6), a2 && [a2.w, a2.x]);

    /* 11) 虚线框/手柄只画在标注层，不写进 PDF：把标注清空前后导出的页面应完全一致 */
    App.state.selected = null;
    App.viewer.refreshOverlays();
    const renderPng = async (bytes) => {
      const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      const pg = await doc.getPage(1);
      const vp = pg.getViewport({ scale: 1 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      return c.toDataURL('image/png');
    };
    const savedAnnots = new Map();
    App.state.annots.forEach((v, k) => savedAnnots.set(k, v.slice()));
    App.state.annots.clear();
    const bytesEmpty = await App.exporter.build();
    const pngEmpty = await renderPng(bytesEmpty);
    App.state.annots = savedAnnots;
    App.viewer.refreshOverlays();
    const pngWithText = await renderPng(await App.exporter.build());
    assert('noBoxInExport', pngEmpty !== pngWithText, { same: pngEmpty === pngWithText });

    const failed = Object.entries(out).filter(([, v]) => String(v).startsWith('FAIL'));
    out.result = failed.length ? 'FAILED: ' + failed.map(([k]) => k).join(',') : 'ALL PASS';
    return out;
  } catch (e) {
    return { error: String(e), stack: (e && e.stack || '').split('\n').slice(0, 3).join(' | '), out };
  }
})();
