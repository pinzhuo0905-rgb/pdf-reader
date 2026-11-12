/* 回归用例：本轮自检发现并修复的缺陷，防止再次退化 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const assert = (k, ok, extra) => {
    out[k] = ok ? 'ok' : 'FAIL' + (extra === undefined ? '' : ' ' + JSON.stringify(extra));
  };
  const dir = (p) => (p || '').replace(/[\\/][^\\/]+$/, '');

  try {
    for (let i = 0; i < 120 && !App.state.pdfDoc; i++) await sleep(100);
    await sleep(700);

    /* 1) 仅旋转页面也应可保存，且旋转写入 PDF */
    App.viewer.rotatePage(0, 90);
    await sleep(500);
    assert('rotateMakesDirty', App.history.snapshot() !== App.state.savedFingerprint);
    const bytes = await App.exporter.build();
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const p1 = await doc.getPage(1);
    assert('rotateWritten', p1.rotate === 90, p1.rotate);
    App.history.undo();
    await sleep(500);
    assert('rotateUndone', App.state.pages[0].rot === 0, App.state.pages[0].rot);

    /* 2) 中间插入空白页：DOM 顺序必须与数据一致 */
    App.viewer.insertBlankPage(0);
    await sleep(500);
    const domIds = [...document.querySelectorAll('#views .view.active .page')].map((e) => e.dataset.id);
    const stateIds = App.state.pages.map((x) => x.id);
    assert('insertOrder', JSON.stringify(domIds) === JSON.stringify(stateIds), { domIds, stateIds });
    App.history.undo();
    await sleep(500);

    /* 3) 侧栏打开时切换标签页，缩略图应换成新文档 */
    App.ui.toggleSidebar();
    await sleep(1200);
    await App.tabs.openPath(dir(App.state.filePath) + '/physics-notes.pdf');
    await sleep(1500);
    const thumbIds = [...document.querySelectorAll('#thumbs .thumb')].map((e) => e.dataset.id);
    assert('thumbsFollowTab', JSON.stringify(thumbIds) === JSON.stringify(App.state.pages.map((x) => x.id)));
    App.ui.toggleSidebar();
    await sleep(300);

    /* 4) 搜索框里按 Delete 不能删掉选中的标注 */
    App.ui.setTool('select');
    const page = App.state.pages[0];
    const a = App.annots.add(page.id, { type: 'whiteout', x: 0.1, y: 0.1, w: 0.2, h: 0.05, color: '#fff' });
    App.state.selected = { pageId: page.id, annotId: a.id };
    const input = document.getElementById('search-input');
    document.getElementById('searchbar').classList.remove('hidden');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    await sleep(200);
    assert('deleteInInputKeepsAnnot', App.annots.get(page.id).some((x) => x.id === a.id));
    App.annots.remove(page.id, a.id);
    App.state.selected = null;
    document.getElementById('searchbar').classList.add('hidden');

    /* 5) 关闭 OCR 面板后不应残留框选监听器 */
    App.ocr.open();
    App.ocr.startRegionSelect();
    await sleep(200);
    App.ocr.close();
    await sleep(200);
    const r = App.state.pages[0].el.getBoundingClientRect();
    App.state.pages[0].el.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: r.left + 40, clientY: r.top + 40, bubbles: true, cancelable: true, button: 0 })
    );
    await sleep(250);
    assert('ocrEscNoLeak', !document.querySelector('div[style*="z-index:60"]'));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    /* 6) 连续搜索不互相污染 */
    const r1 = App.viewer.search('氮');
    const r2 = App.viewer.search('硝化');
    await Promise.all([r1, r2]);
    await sleep(300);
    assert('searchNoRace', App.state.search.query === '硝化');

    /* 7) 单标签拖出应被拒绝（拖拽移动窗口），右键强制才开新窗口 */
    while (App.tabs.list.length > 1) App.tabs.close(App.tabs.list[App.tabs.list.length - 1].id, true);
    await sleep(400);
    const res = await App.tabs.detach(App.tabs.active());
    assert('detachSingleSkipped', !!(res && res.skipped), res);

    const failed = Object.entries(out).filter(([, v]) => String(v).startsWith('FAIL'));
    out.result = failed.length ? 'FAILED: ' + failed.map(([k]) => k).join(',') : 'ALL PASS';
    return out;
  } catch (e) {
    return { error: String(e), stack: (e && e.stack || '').split('\n').slice(0, 3).join(' | '), out };
  }
})();
