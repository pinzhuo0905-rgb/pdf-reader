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
    assert('zhFontSimSun', /SimSun|宋体/i.test(zhFont), zhFont);
    const zhTitle = $('btn-more').title;
    App.i18n.setLang('en', { silent: true });
    await sleep(200);
    const enTitle = $('btn-more').title;
    const enFont = getComputedStyle(document.body).fontFamily;
    assert('langEnTitle', enTitle === 'More tools' && enTitle !== zhTitle, [zhTitle, enTitle]);
    assert('langEnFontTimes', /Times New Roman/i.test(enFont), enFont);
    assert('langEnHtml', document.documentElement.lang === 'en', document.documentElement.lang);
    assert('langEnEditbar', $('eb-textedit').textContent.trim() === 'Edit text', $('eb-textedit').textContent.trim());
    assert('langEnSearch', $('search-input').placeholder === 'Search in document', $('search-input').placeholder);

    // 切回中文
    App.i18n.setLang('zh', { silent: true });
    await sleep(200);
    assert('langZhTitle', $('btn-more').title === '更多工具', $('btn-more').title);
    assert('langZhEditbar', $('eb-textedit').textContent.trim() === '编辑文字', $('eb-textedit').textContent.trim());
    assert('langZhFontBack', /SimSun|宋体/i.test(getComputedStyle(document.body).fontFamily));

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
