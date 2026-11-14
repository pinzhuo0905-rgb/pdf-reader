/* 界面增强：双页视图、缩放滑块与平滑缩放、中英切换与字体、更多按钮三点图标、页内原地编辑 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const assert = (k, ok, extra) => {
    out[k] = ok ? 'ok' : 'FAIL' + (extra === undefined ? '' : ' ' + JSON.stringify(extra));
  };
  const $ = (id) => document.getElementById(id);

  try {
    for (let i = 0; i < 150 && !App.state.pdfDoc; i++) await sleep(100);
    await sleep(900);

    const st = () => App.state;
    const page = st().pages[0];
    const pagesEl = $('views').querySelector('.view.active .pages');

    /* ---------------- 1) 双页视图：真的变成每行两页 ---------------- */
    const before = {
      cls: pagesEl.classList.contains('two-up'),
      width: pagesEl.style.width,
      tops: st().pages.slice(0, 3).map((p) => Math.round(p.el.offsetTop)),
    };
    $('btn-viewmode').click();
    await sleep(500);
    const p1 = st().pages[0].el;
    const p2 = st().pages[1].el;
    const p3 = st().pages[2].el;
    const after = {
      cls: pagesEl.classList.contains('two-up'),
      width: parseInt(pagesEl.style.width, 10) || 0,
      sameRow: Math.abs(p1.offsetTop - p2.offsetTop) <= 2,
      nextRow: Math.abs(p3.offsetTop - p1.offsetTop) > 10,
      sideBySide: p2.offsetLeft > p1.offsetLeft + p1.offsetWidth - 2,
      btnActive: $('btn-viewmode').classList.contains('active'),
    };
    assert('twoUpOffInitially', !before.cls, before);
    assert('twoUpClass', after.cls);
    assert('twoUpWidthSet', after.width > 0, after.width);
    assert('twoUpTwoPerRow', after.sameRow && after.nextRow, after);
    assert('twoUpSideBySide', after.sideBySide, [p1.offsetLeft, p2.offsetLeft]);
    assert('twoUpButtonActive', after.btnActive);

    // 关掉恢复单页
    $('btn-viewmode').click();
    await sleep(400);
    const back = {
      cls: pagesEl.classList.contains('two-up'),
      width: pagesEl.style.width,
      stacked: st().pages[1].el.offsetTop > st().pages[0].el.offsetTop + 10,
    };
    assert('twoUpOff', !back.cls && !back.width && back.stacked, back);

    /* ---------------- 2) 缩放滑块：位置、联动、平滑 ---------------- */
    const range = $('zoom-range');
    assert('zoomRangeExists', !!range);
    const center = $('btn-zoom-in').parentElement;
    const kids = Array.from(center.children);
    const iMinus = kids.indexOf($('btn-zoom-out'));
    const iRange = kids.indexOf(range);
    const iPlus = kids.indexOf($('btn-zoom-in'));
    assert('zoomRangeBetweenButtons', iMinus >= 0 && iRange === iMinus + 1 && iPlus === iRange + 1, [iMinus, iRange, iPlus]);

    const z0 = st().zoom;
    assert('zoomRangeSynced', Math.abs(Number(range.value) - z0 * 100) <= 2, [range.value, z0]);

    // 拖到 200%
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    range.value = '200';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(400);
    const z200 = st().zoom;
    assert('zoomRangeZooms', Math.abs(z200 - 2) < 0.02, z200);
    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    // Ctrl + 滚轮：应该朝放大方向变化，且鼠标下的内容不跑位（锚点保持）
    const area = $('views').querySelector('.view.active .scroll-area');
    const r = area.getBoundingClientRect();
    const beforeWheel = st().zoom;
    const anchorNy = () => {
      const pr2 = st().pages[0].el.getBoundingClientRect();
      return (r.top + r.height / 2 - pr2.top) / pr2.height;
    };
    const nyBefore = anchorNy();
    area.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      })
    );
    await sleep(400);
    const afterWheel = st().zoom;
    assert('ctrlWheelZoomIn', afterWheel > beforeWheel + 0.01, [beforeWheel, afterWheel]);
    assert('ctrlWheelKeepsAnchor', Math.abs(anchorNy() - nyBefore) < 0.03, [nyBefore, anchorNy()]);

    // 普通滚轮不应该改变缩放
    const zPlain = st().zoom;
    area.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
    await sleep(250);
    assert('plainWheelNoZoom', Math.abs(st().zoom - zPlain) < 0.001, [zPlain, st().zoom]);

    // Ctrl + ↓ 平滑缩小
    const zKey = st().zoom;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true }));
    await sleep(400);
    assert('ctrlArrowZoom', st().zoom < zKey - 0.01, [zKey, st().zoom]);

    App.viewer.setZoom(1, 'custom');
    await sleep(300);

    /* ---------------- 3) 语言切换与字体 ---------------- */
    const zhFont = getComputedStyle(document.body).fontFamily;
    assert('zhFontYaHeiUI', /Microsoft YaHei UI/i.test(zhFont), zhFont);
    assert(
      'fontFamiliesInstalled',
      document.fonts.check('13px "Microsoft YaHei UI"') && document.fonts.check('13px "Segoe UI"'),
      [document.fonts.check('13px "Microsoft YaHei UI"'), document.fonts.check('13px "Segoe UI"')]
    );
    const zhTitle = $('btn-more').title;
    App.i18n.setLang('en', { silent: true });
    await sleep(200);
    const enTitle = $('btn-more').title;
    const enFont = getComputedStyle(document.body).fontFamily;
    assert('langEnTitle', enTitle === 'More tools' && enTitle !== zhTitle, [zhTitle, enTitle]);
    assert('langEnFontSegoeUI', /Segoe UI/i.test(enFont), enFont);
    assert('langEnHtml', document.documentElement.lang === 'en', document.documentElement.lang);
    assert('langEnEditbar', $('eb-textedit').textContent.trim() === 'Edit text', $('eb-textedit').textContent.trim());
    assert('langEnSearch', $('search-input').placeholder === 'Search in document', $('search-input').placeholder);

    // 切回中文
    App.i18n.setLang('zh', { silent: true });
    await sleep(200);
    assert('langZhTitle', $('btn-more').title === '更多工具', $('btn-more').title);
    assert('langZhEditbar', $('eb-textedit').textContent.trim() === '编辑文字', $('eb-textedit').textContent.trim());
    assert('langZhFontBack', /Microsoft YaHei UI/i.test(getComputedStyle(document.body).fontFamily));

    /* ---------------- 4) 「更多工具」改成三个点 ---------------- */
    const moreSvg = $('btn-more').querySelector('svg');
    const dots = moreSvg ? moreSvg.querySelectorAll('circle').length : 0;
    assert('moreIconThreeDots', dots === 3, dots);
    assert('moreIconNoText', !moreSvg || !moreSvg.querySelector('text'), moreSvg && moreSvg.innerHTML.slice(0, 40));

    /* ---------------- 5) 页内原地编辑（不弹浮层） ---------------- */
    App.ui.setTool('textedit');
    await sleep(300);
    // 点第一页文字区域（样例 PDF 有文本层）
    await App.viewer.ensureTextItems(page);
    const items = App.viewer.getTextItems(page.id);
    assert('hasTextItems', items.length > 0, items.length);
    const it = items.find((x) => x.str && x.str.length > 4) || items[0];
    const pr = page.el.getBoundingClientRect();
    const cx = pr.left + it.left + it.width / 2;
    const cy = pr.top + it.top + it.height / 2;
    page.el.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true, button: 0 }));
    await sleep(250);
    const ed = $('textEditor');
    assert('inlineEditorOpened', !!ed);
    assert('inlineEditorInPage', ed && ed.parentElement === page.el, ed && ed.parentElement && ed.parentElement.className);
    assert('inlineEditorNoButtons', ed && !ed.querySelector('button'), ed && ed.querySelectorAll('button').length);
    const edRect = ed && ed.getBoundingClientRect();
    assert(
      'inlineEditorNearText',
      !!edRect && Math.abs(edRect.left - (pr.left + it.left)) < 6 && Math.abs(edRect.top - (pr.top + it.top)) < 12,
      edRect && [Math.round(edRect.left - pr.left), Math.round(edRect.top - pr.top), Math.round(it.left), Math.round(it.top)]
    );

    const input = $('textEditorInput');
    input.value = 'Inline 编辑测试';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(350);
    assert('inlineEditorClosedAfterEnter', !$('textEditor'));
    const te = App.annots.get(page.id).find((a) => a.type === 'textedit');
    assert('inlineCommitWroteAnnot', !!te && te.text === 'Inline 编辑测试', te && te.text);

    // Esc 取消不写入
    App.ui.setTool('textedit');
    await sleep(150);
    App.annotate.openTextCreator(page, 0.6, 0.8);
    await sleep(200);
    const n0 = App.annots.get(page.id).length;
    $('textEditorInput').value = '不该保存';
    $('textEditorInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await sleep(200);
    assert('inlineEscCancels', !$('textEditor') && App.annots.get(page.id).length === n0, [n0, App.annots.get(page.id).length]);

    /* ---------------- 5.5) 触控板捏合 / 斜向手势 ---------------- */
    const area2 = $('views').querySelector('.view.active .scroll-area');
    const ar2 = area2.getBoundingClientRect();
    const pinchAt = { x: ar2.left + ar2.width * 0.62, y: ar2.top + ar2.height * 0.42 };
    const fireWheel = (dx, dy, extra = {}) =>
      area2.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: dx,
          deltaY: dy,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
          clientX: pinchAt.x,
          clientY: pinchAt.y,
          ...extra,
        })
      );
    const normAt = (pageEl, pt) => {
      const r = pageEl.getBoundingClientRect();
      return { nx: (pt.x - r.left) / r.width, ny: (pt.y - r.top) / r.height };
    };
    const pagesEl2 = $('views').querySelector('.view.active .pages');
    const pageEl2 = st().pages[0].el;

    // 30 次 deltaY=-1 的慢速捏合：应放大约 4.6%，且中途不跳变
    App.viewer.setZoom(1, 'custom');
    await sleep(400);
    const zPinchStart = st().zoom;
    const samples = [];
    for (let i = 0; i < 30; i++) {
      fireWheel(0, -1);
      await sleep(16);
      samples.push(st().zoom);
    }
    const pinchPreviewScale = parseFloat((pagesEl2.style.transform.match(/scale\(([\d.]+)\)/) || [0, 1])[1]);
    await sleep(450);
    const zPinch = st().zoom;
    assert('pinchInGrows', zPinch > zPinchStart * 1.03 && zPinch < zPinchStart * 1.1, [+zPinchStart.toFixed(3), +zPinch.toFixed(3)]);
    assert(
      'pinchPreviewTracksFinger',
      Math.abs(pinchPreviewScale - zPinch / zPinchStart) < 0.02,
      [pinchPreviewScale, +(zPinch / zPinchStart).toFixed(4)]
    );
    assert('pinchNoTransformLeft', !pagesEl2.style.transform, pagesEl2.style.transform);
    const pinchPageW = pageEl2.getBoundingClientRect().width;
    assert('pinchSizeMatchesZoom', Math.abs(pinchPageW - st().pages[0].wPt * st().zoom) < 2, [Math.round(pinchPageW), Math.round(st().pages[0].wPt * st().zoom)]);

    // 反向捏合：应缩小，且不越过上下限
    for (let i = 0; i < 30; i++) {
      fireWheel(0, 1);
      await sleep(16);
    }
    await sleep(450);
    assert('pinchOutShrinks', st().zoom < zPinch * 0.97, [+zPinch.toFixed(3), +st().zoom.toFixed(3)]);

    // deltaMode=1（行模式）应被归一化：一行 ≈ 16px，缩放幅度不能趋近于 0
    App.viewer.setZoom(1, 'custom');
    await sleep(400);
    fireWheel(0, -1, { deltaMode: 1 });
    await sleep(450);
    assert('pinchLineModeNormalized', st().zoom > 1.01, +st().zoom.toFixed(4));

    // 斜向双指滑动（横向占主导）：不应触发缩放
    App.viewer.setZoom(1, 'custom');
    await sleep(400);
    const zBeforeDiag = st().zoom;
    for (let i = 0; i < 20; i++) {
      fireWheel(-40, -2);
      await sleep(16);
    }
    await sleep(450);
    assert('diagonalNoAccidentalZoom', Math.abs(st().zoom - zBeforeDiag) < 0.001, [+zBeforeDiag.toFixed(3), +st().zoom.toFixed(3)]);

    // 高倍率下捏合：锚点（鼠标下的内容）应保持不动
    App.viewer.setZoom(2.5, 'custom');
    await sleep(500);
    area2.scrollLeft = 40;
    await sleep(80);
    const pa0 = normAt(pageEl2, pinchAt);
    for (let i = 0; i < 12; i++) {
      fireWheel(0, -4);
      await sleep(16);
    }
    await sleep(450);
    const pa1 = normAt(pageEl2, pinchAt);
    assert('pinchKeepsAnchorX', Math.abs(pa1.nx - pa0.nx) < 0.02, [+pa0.nx.toFixed(3), +pa1.nx.toFixed(3)]);
    assert('pinchKeepsAnchorY', Math.abs(pa1.ny - pa0.ny) < 0.02, [+pa0.ny.toFixed(3), +pa1.ny.toFixed(3)]);

    // 鼠标 Ctrl+滚轮一格：应该「滑过去」而不是一步跳到位
    App.viewer.setZoom(1, 'custom');
    await sleep(450);
    const zNotchStart = st().zoom;
    // 平滑期间 state.zoom 不变，只有预览 transform 在动，所以取 transform 的 scale
    const previewScale = () => {
      const m = pagesEl2.style.transform.match(/scale\(([\d.]+)\)/);
      return m ? parseFloat(m[1]) : 1;
    };
    fireWheel(0, -120, { deltaMode: 0 });
    await sleep(45);
    const scaleMid = previewScale();
    await sleep(420);
    const zNotchEnd = st().zoom;
    assert('wheelNotchMoves', zNotchEnd > zNotchStart * 1.15, [+zNotchStart.toFixed(3), +zNotchEnd.toFixed(3)]);
    assert(
      'wheelNotchSmooth',
      scaleMid > 1.02 && scaleMid < zNotchEnd / zNotchStart - 0.005,
      { mid45ms: +scaleMid.toFixed(3), end: +(zNotchEnd / zNotchStart).toFixed(3) }
    );

    // 灵敏度：一格 ≈ 1.30 倍（exp(0.0022*120)）
    assert('wheelSensitivity', zNotchEnd / zNotchStart > 1.22 && zNotchEnd / zNotchStart < 1.38, +(zNotchEnd / zNotchStart).toFixed(3));

    // 连续三格应累乘
    App.viewer.setZoom(1, 'custom');
    await sleep(450);
    for (let i = 0; i < 3; i++) {
      fireWheel(0, -120, { deltaMode: 0 });
      await sleep(40);
    }
    await sleep(450);
    assert('wheelNotchAccumulates', st().zoom > 1.9 && st().zoom < 2.5, +st().zoom.toFixed(3));

    // 单次超大 delta（快速捏合）：不应把缩放顶到极限
    App.viewer.setZoom(1, 'custom');
    await sleep(400);
    fireWheel(0, -400);
    await sleep(450);
    assert('pinchHugeDeltaClamped', st().zoom > 1 && st().zoom < 2.2, +st().zoom.toFixed(3));

    App.viewer.setZoom(1, 'custom');
    await sleep(300);

    /* ---------------- 5.6) 动画与文案细节 ---------------- */
    // 缩放时不能闪白：把画布缩到 60x80 采样，统计非白像素，取整段时间的最小值
    const tiny = document.createElement('canvas');
    tiny.width = 60;
    tiny.height = 80;
    const tctx = tiny.getContext('2d', { willReadFrequently: true });
    const inkCount = (canvas) => {
      if (!canvas || !canvas.width) return 0;
      tctx.clearRect(0, 0, 60, 80);
      tctx.drawImage(canvas, 0, 0, 60, 80);
      const d = tctx.getImageData(0, 0, 60, 80).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) n++;
      return n;
    };

    App.viewer.setZoom(1, 'custom');
    await sleep(600);
    const inkBefore = inkCount(st().pages[0].canvas);
    let minInk = Infinity;
    $('btn-zoom-in').click();
    for (let i = 0; i < 30; i++) {
      await sleep(20);
      minInk = Math.min(minInk, inkCount(st().pages[0].canvas));
    }
    assert('zoomNoWhiteFlash', inkBefore > 5 && minInk > 3, { before: inkBefore, min: minInk });
    await sleep(400);

    // 展开列表：从上往下滑出（menu-in）
    $('btn-more').click();
    await sleep(60);
    const menuEl = document.querySelector('#menuLayer .menu');
    assert('menuSlideAnim', !!menuEl && getComputedStyle(menuEl).animationName === 'menu-in', menuEl && getComputedStyle(menuEl).animationName);
    document.getElementById('menuLayer').classList.add('hidden');

    // 侧栏：浮层 + 从左滑出（slide-in-left），且不推挤文档
    const pageEl = st().pages[0].el;
    const rectBefore = pageEl.getBoundingClientRect();
    const areaBefore = $('views').querySelector('.view.active .scroll-area').clientWidth;
    App.viewer.toggleSidebar(true);
    await sleep(60);
    const sb = $('sidebar');
    assert('sidebarSlideAnim', getComputedStyle(sb).animationName === 'slide-in-left', getComputedStyle(sb).animationName);
    assert('sidebarFloats', getComputedStyle(sb).position === 'absolute', getComputedStyle(sb).position);
    assert('sidebarHasShadow', getComputedStyle(sb).boxShadow !== 'none', getComputedStyle(sb).boxShadow.slice(0, 30));
    // 隐藏窗口里 CSS 动画不推进，测几何前先快进到终态
    sb.getAnimations().forEach((a) => {
      try {
        a.finish();
      } catch (e) {}
    });
    await sleep(300);
    const rectAfter = pageEl.getBoundingClientRect();
    const areaAfter = $('views').querySelector('.view.active .scroll-area').clientWidth;
    assert('sidebarNoPush', Math.abs(rectAfter.left - rectBefore.left) < 1 && Math.abs(rectAfter.width - rectBefore.width) < 1, {
      before: [Math.round(rectBefore.left), Math.round(rectBefore.width)],
      after: [Math.round(rectAfter.left), Math.round(rectAfter.width)],
    });
    assert('sidebarNoReflow', Math.abs(areaAfter - areaBefore) < 1, [areaBefore, areaAfter]);
    // 浮层应该真的盖在页面上（命中测试落在侧栏内部）
    const hit = document.elementFromPoint(60, 200);
    assert('sidebarOnTop', !!hit && sb.contains(hit), hit && (hit.id || hit.className));
    App.viewer.toggleSidebar(false);
    await sleep(200);

    // 悬停：图标与展开箭头各自独立高亮
    const hoverCss = (sel) => {
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch (e) {
          continue;
        }
        for (const r of rules) {
          if (r.selectorText === sel) return r.style;
        }
      }
      return null;
    };
    const caretHoverRule = hoverCss('.caret:hover');
    const iconHoverRule = hoverCss('.icon-btn:hover:not(:disabled)');
    assert('caretOwnHoverRule', !!caretHoverRule && caretHoverRule.background !== '', caretHoverRule && caretHoverRule.background);
    assert('iconOwnHoverRule', !!iconHoverRule && iconHoverRule.background !== '', iconHoverRule && iconHoverRule.background);
    assert('noGroupHoverRule', hoverCss('.tb-group:hover') === null);

    // 工具栏上每一种按钮都必须有自己的悬停反馈（带文字的「绘制」曾经漏掉）
    const hoverGaps = ['.icon-btn:hover:not(:disabled)', '.labeled-btn:hover:not(:disabled)', '.caret:hover', '.text-btn:hover'].filter(
      (sel) => {
        const r = hoverCss(sel);
        return !r || r.background === '';
      }
    );
    assert('allToolbarButtonsHoverable', hoverGaps.length === 0, hoverGaps);

    // 双页提示只说「双页视图」
    App.viewer.setTwoUp(false);
    await sleep(200);
    $('btn-viewmode').click();
    await sleep(150);
    assert('twoUpToastShort', $('toast').textContent === '双页视图', $('toast').textContent);
    $('btn-viewmode').click();
    await sleep(300);

    // 语言菜单不写字体名
    assert(
      'langMenuNoFontName',
      App.i18n.t('menu.langZh') === '中文' && App.i18n.t('menu.langEn') === 'English',
      [App.i18n.t('menu.langZh'), App.i18n.t('menu.langEn')]
    );

    /* ---------------- 5.7) 适应宽度平滑缩放 / 新标签滑出 / 界面字体 ---------------- */

    // 隐藏窗口里 rAF 不触发，用 setTimeout 顶上才能采到中间帧
    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    const pagesEl3 = $('views').querySelector('.view.active .pages');
    const curScale = () => {
      const m = pagesEl3.style.transform.match(/scale\(([\d.]+)\)/);
      return m ? parseFloat(m[1]) : 1;
    };

    // A) 从 2.6 点「适应宽度」：应当是平滑缩小，不是一步到位
    App.viewer.setZoom(2.6, 'custom');
    await sleep(450);
    const zBeforeFit = st().zoom;
    $('btn-fit-width').click();
    await sleep(90);
    const zMidFit = st().zoom;
    const fitSamples = [];
    const tFit = performance.now();
    for (let i = 0; i < 22; i++) {
      await sleep(25);
      fitSamples.push([Math.round(performance.now() - tFit), curScale()]);
    }
    await sleep(400);
    const zAfterFit = st().zoom;
    assert('fitWidthNotInstant', Math.abs(zMidFit - zBeforeFit) < 0.001, [+zBeforeFit.toFixed(3), +zMidFit.toFixed(3)]);
    assert('fitWidthShrinks', zAfterFit < zBeforeFit - 0.3, [+zBeforeFit.toFixed(3), +zAfterFit.toFixed(3)]);
    assert('fitWidthModeSet', st().zoomMode === 'fitWidth', st().zoomMode);

    // 曲线：中段速度最大，最后还要再加速一次（不是一路减速）
    // 只统计动画帧：落位后 transform 会被清掉，curScale() 会跳回 1，不能算进曲线
    const fitCurve = fitSamples.filter((x) => x[0] <= 430 && x[1] < 0.999);
    const fitDeltas = [];
    for (let i = 1; i < fitCurve.length; i++) fitDeltas.push(Math.abs(fitCurve[i][1] - fitCurve[i - 1][1]));
    const maxAt = fitDeltas.indexOf(Math.max(...fitDeltas));
    const tailMin = Math.min(...fitDeltas.slice(-4));
    const tailLast = fitDeltas[fitDeltas.length - 1];
    assert('fitWidthCurveNotLinear', fitDeltas.length >= 8 && maxAt < fitDeltas.length * 0.7, {
      maxAt,
      n: fitDeltas.length,
      curve: fitCurve.map((x) => x[1].toFixed(3)),
    });
    // 末段速度要比中后段的最低点更快 —— 这就是「再加速」
    assert('fitWidthFinalPush', tailLast > tailMin * 1.4, {
      tailLast: +tailLast.toFixed(4),
      tailMin: +tailMin.toFixed(4),
      deltas: fitDeltas.map((d) => +d.toFixed(4)),
    });
    assert('fitWidthTransformCleared', !pagesEl3.style.transform, pagesEl3.style.transform);

    // 适应后页面宽度应贴合可视区（不再溢出）
    const areaW = $('views').querySelector('.view.active .scroll-area').clientWidth;
    const pageW = st().pages[0].el.getBoundingClientRect().width;
    assert('fitWidthFitsViewport', pageW > areaW * 0.8 && pageW < areaW, [Math.round(pageW), areaW]);

    window.requestAnimationFrame = origRaf;

    // B) 新标签滑出：宽度 0 → 目标宽，多段缓动，结束后清掉内联样式
    const tabsBefore = document.querySelectorAll('#tabstrip .tab').length;
    $('tab-new').click();
    await sleep(160);
    const tabEls = [...document.querySelectorAll('#tabstrip .tab')];
    const newTab = tabEls[tabEls.length - 1];
    const slideAnim = newTab.getAnimations()[0];
    const kf = slideAnim ? slideAnim.effect.getKeyframes() : [];
    assert('tabSlideAnim', !!slideAnim && slideAnim.effect.getTiming().duration === 340, slideAnim && slideAnim.effect.getTiming().duration);
    assert('tabSlideKeyframes', kf.length === 4 && kf[0].width === '0px' && Math.abs(kf[2].offset - 0.78) < 0.01, kf.map((k) => [k.offset, k.width]));
    assert('tabSlideGrew', tabEls.length === tabsBefore + 1, [tabsBefore, tabEls.length]);
    await sleep(600);
    assert('tabSlideCleanup', !newTab.style.minWidth && newTab.getAnimations().length === 0, {
      minWidth: newTab.style.minWidth,
      anims: newTab.getAnimations().length,
    });
    const newTabW = Math.round(newTab.getBoundingClientRect().width);
    assert('tabSlideFinalWidth', newTabW >= 72 && newTabW <= 208, newTabW);
    App.tabs.close(newTab.dataset.id, true);
    await sleep(250);

    /* ---------------- 6) 设置菜单里的语言开关 + 持久化 ---------------- */
    $('btn-settings').click();
    await sleep(200);
    const langItems = document.querySelectorAll('#menuLayer .menu-item[data-l]');
    assert('settingsHasLangMenu', langItems.length === 2, langItems.length);
    langItems[1].click();
    await sleep(300);
    assert('settingsLangApplied', App.i18n.lang === 'en' && $('btn-more').title === 'More tools', App.i18n.lang);
    const saved = await window.api.getSettings();
    assert('settingsLangPersisted', saved && saved.lang === 'en', saved && saved.lang);
    // 切回中文并写回设置，避免影响后续用例和本机上的应用
    App.i18n.setLang('zh', { silent: true });
    await window.api.setSettings({ lang: 'zh' });
    await sleep(150);

    const failed = Object.entries(out).filter(([, v]) => String(v).startsWith('FAIL'));
    out.result = failed.length ? 'FAILED: ' + failed.map(([k]) => k).join(',') : 'ALL PASS';
    return out;
  } catch (e) {
    return { error: String(e), stack: ((e && e.stack) || '').split('\n').slice(0, 3).join(' | '), out };
  }
})();
