/* 橡皮擦：圆形笔尖、可调半径、按点裁断而不是删整条 */
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

    App.viewer.setZoom(1, 'custom');
    await sleep(600);
    const page = App.state.pages[0];
    const el = page.el;
    const W = () => page.wPt * App.state.zoom;
    const H = () => page.hPt * App.state.zoom;
    const toClient = (nx, ny) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + nx * r.width, y: r.top + ny * r.height };
    };
    const inkList = () => App.annots.get(page.id).filter((a) => a.type === 'ink');
    const totalPts = () => inkList().reduce((n, a) => n + a.points.length, 0);
    const down = (nx, ny) => {
      const p = toClient(nx, ny);
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0, buttons: 1 }));
    };
    const moveTo = (nx, ny) => {
      const p = toClient(nx, ny);
      el.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y, bubbles: true, buttons: 1 }));
    };
    const up = () => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

    /* 造一条 61 个点的横线 */
    const pts = [];
    for (let i = 0; i <= 60; i++) pts.push({ x: 0.1 + (0.5 * i) / 60, y: 0.5 });
    App.annots.add(page.id, { type: 'ink', points: pts, color: '#e81123', width: 3 });
    await sleep(300);
    assert('strokeCreated', inkList().length === 1 && totalPts() === 61, [inkList().length, totalPts()]);

    /* 橡皮：半径 10px，点中间一下 */
    App.ui.setTool('eraser');
    await sleep(200);
    App.state.opts.eraserRadius = 10;
    const cx = 0.35;
    const cy = 0.5;
    down(cx, cy);
    up();
    await sleep(400);

    const afterClick = inkList();
    const r = 10;
    let inside = 0;
    for (const a of afterClick) {
      for (const p of a.points) {
        const dx = p.x * W() - cx * W();
        const dy = p.y * H() - cy * H();
        if (dx * dx + dy * dy < (r - 0.5) * (r - 0.5)) inside++;
      }
    }
    assert('notWholeStrokeDeleted', afterClick.length >= 1 && totalPts() > 0, [afterClick.length, totalPts()]);
    assert('splitIntoTwo', afterClick.length === 2, afterClick.length);
    assert('pointsRemoved', totalPts() < 61, totalPts());
    assert('noPointInsideCircle', inside === 0, inside);
    assert('dirtyAfterErase', App.state.dirty === true);

    /* 拖动擦除：从 0.18 拖到 0.28，应再断出更多段 */
    const beforeDrag = totalPts();
    down(0.18, 0.5);
    for (let i = 1; i <= 8; i++) {
      moveTo(0.18 + (0.1 * i) / 8, 0.5);
      await sleep(20);
    }
    up();
    await sleep(400);
    assert('dragErasesMore', totalPts() < beforeDrag, [beforeDrag, totalPts()]);
    assert('stillHasSegments', inkList().length >= 2, inkList().length);

    /* 半径变大：同样的点击擦掉更多 */
    const beforeBig = totalPts();
    App.state.opts.eraserRadius = 40;
    await sleep(100);
    down(0.45, 0.5);
    up();
    await sleep(300);
    assert('radiusAffectsErase', totalPts() < beforeBig, [beforeBig, totalPts()]);

    /* 圆形光标：显示且直径 = 2×半径 */
    App.state.opts.eraserRadius = 18;
    moveTo(0.3, 0.4);
    await sleep(200);
    const cur = document.querySelector('.eraser-cursor');
    const rect = cur ? cur.getBoundingClientRect() : null;
    assert('cursorVisible', !!cur && !cur.classList.contains('hidden'));
    assert('cursorSize', !!rect && Math.abs(rect.width - 36) < 2 && Math.abs(rect.height - 36) < 2, rect && [rect.width, rect.height]);
    assert('systemCursorHidden', getComputedStyle(el).cursor === 'none', getComputedStyle(el).cursor);

    /* 空白处擦不到东西 */
    const beforeEmpty = inkList().length + App.annots.get(page.id).length;
    down(0.85, 0.85);
    up();
    await sleep(200);
    assert('emptyNoChange', inkList().length + App.annots.get(page.id).length === beforeEmpty);

    /* 撤销：三次擦除各记一步，撤销 3 次回到最初的一条 */
    for (let i = 0; i < 3; i++) {
      App.history.undo();
      await sleep(400);
    }
    assert('undoRestoresStroke', inkList().length === 1 && totalPts() === 61, [inkList().length, totalPts()]);

    /* 非涂鸦对象（高亮）：圆点落上去仍然整体删除 */
    App.ui.setTool('select');
    await sleep(150);
    App.annots.add(page.id, { type: 'highlight', rects: [{ x: 0.2, y: 0.7, w: 0.3, h: 0.04 }], color: '#ffe14d' });
    await sleep(250);
    App.ui.setTool('eraser');
    await sleep(200);
    down(0.3, 0.72);
    up();
    await sleep(300);
    assert('objectDeleted', !App.annots.get(page.id).some((a) => a.type === 'highlight'));

    /* 切走工具后圆点收起 */
    App.ui.setTool('select');
    await sleep(250);
    const c2 = document.querySelector('.eraser-cursor');
    assert('cursorHiddenOnToolChange', !c2 || c2.classList.contains('hidden'));

    /* 橡皮大小菜单（按钮右侧箭头） */
    $('btn-eraser-caret').click();
    await sleep(350);
    const range = document.querySelector('#eraser-range');
    assert('menuHasRadius', !!range && range.min === '4' && range.max === '48', range && [range.min, range.max]);
    assert('menuSwitchesTool', App.state.tool === 'eraser', App.state.tool);
    range.value = '30';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    assert('menuSetsRadius', App.state.opts.eraserRadius === 30, App.state.opts.eraserRadius);
    assert('groupActive', $('grp-eraser').classList.contains('active'));
    $('menuLayer').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await sleep(200);

    const failed = Object.entries(out).filter(([, v]) => String(v).startsWith('FAIL'));
    out.result = failed.length ? 'FAILED: ' + failed.map(([k]) => k).join(',') : 'ALL PASS';
    return out;
  } catch (e) {
    return { error: String(e), stack: (e && e.stack || '').split('\n').slice(0, 3).join(' | '), out };
  }
})();
