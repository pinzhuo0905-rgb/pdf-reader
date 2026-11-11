/**
 * 自检：多标签页 + 目录侧栏
 *
 * 覆盖：打开第二个文档、同文件去重、拖拽排序、拖出为独立窗口、关闭标签页、
 * 每个标签页的缩放状态互相独立、目录（书签 + 缩略图）渲染与跳转。
 *
 * 运行：npm run test:tabs
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const ids = () => App.tabs.list.map((t) => t.id + ':' + (t.state.fileName || '-'));
  const assert = (name, ok, extra) => {
    out[name] = ok ? 'ok' : 'FAIL' + (extra === undefined ? '' : ' ' + JSON.stringify(extra));
  };

  try {
    for (let i = 0; i < 100 && !App.state.pdfDoc; i++) await sleep(120);
    await sleep(400);

    const firstPath = App.state.filePath;
    const dir = firstPath.replace(/[\\/][^\\/]+$/, '');
    const second = dir + '/physics-notes.pdf';

    // 1) 打开第二个文档 → 新标签页
    await App.tabs.openPath(second);
    await sleep(800);
    assert('secondTabOpened', App.tabs.list.length === 2, ids());
    assert('activeIsSecond', App.tabs.active() === App.tabs.list[1]);
    assert('tabIcon', document.querySelector('#tabstrip .tab .tab-ico').getAttribute('src') === 'assets/pdf-icon-256.png');

    // 2) 同文件再次打开（用反斜杠写法）→ 不新增标签页
    await App.tabs.openPath(firstPath.replace(/\//g, '\\'));
    await sleep(500);
    assert('dedupeByPath', App.tabs.list.length === 2, ids());

    // 3) 目录侧栏：书签 + 缩略图
    App.tabs.activate(App.tabs.list[1].id);
    await sleep(500);
    App.ui.toggleSidebar();
    await sleep(1400);
    assert('sidebarOpen', !document.getElementById('sidebar').classList.contains('hidden'));
    assert('sidebarTitle', document.querySelector('.sb-title').textContent === '目录');
    assert('thumbs', document.querySelectorAll('#thumbs .thumb').length === App.state.pages.length);
    assert('outline', document.querySelectorAll('#outline .ol-item').length === 3);
    const third = document.querySelectorAll('#outline .ol-item')[2];
    if (third) {
      third.click();
      await sleep(900);
      assert('outlineJump', App.state.currentPage === 2, App.state.currentPage);
    }
    App.ui.toggleSidebar();

    // 4) 拖拽排序：把最后一个标签拖到最左
    const last = document.querySelectorAll('#tabstrip .tab')[App.tabs.list.length - 1];
    const lr = last.getBoundingClientRect();
    const y = Math.round(lr.top + lr.height / 2);
    const x0 = Math.round(lr.left + lr.width / 2);
    const before = ids();
    last.dispatchEvent(new PointerEvent('pointerdown', { clientX: x0, clientY: y, bubbles: true, button: 0, buttons: 1 }));
    for (let i = 1; i <= 6; i++) {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 - i * 20, clientY: y, bubbles: true, buttons: 1 }));
      await sleep(20);
    }
    const hint = !document.getElementById('tabDrop').classList.contains('hidden');
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 20, clientY: y, bubbles: true, button: 0 }));
    await sleep(400);
    assert('dropHint', hint);
    assert('reorder', ids()[0] === before[before.length - 1] && ids()[1] === before[0], { before, after: ids() });

    // 5) 每个标签页的缩放互不影响
    const a = App.tabs.active();
    App.viewer.setZoom(1.25, 'custom');
    const b = App.tabs.list.find((t) => t !== a);
    App.tabs.activate(b.id);
    await sleep(600);
    assert('zoomIsolation', Math.abs(a.state.zoom - 1.25) < 0.01 && Math.abs(b.state.zoom - 1.25) > 0.05, {
      a: a.state.zoom,
      b: b.state.zoom,
    });

    // 6) 拖出为独立窗口：标签页减少，主进程会新开窗口
    const beforeDetach = App.tabs.list.length;
    const el = document.querySelectorAll('#tabstrip .tab')[0];
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true, button: 0, buttons: 1 }));
    for (let i = 1; i <= 6; i++) {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: cx + i * 8, clientY: cy + i * 40, bubbles: true, buttons: 1 }));
      await sleep(20);
    }
    const ghostDetach = !!document.querySelector('.tab-ghost.detach');
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 48, clientY: cy + 260, bubbles: true, button: 0 }));
    await sleep(700);
    assert('detachGhost', ghostDetach);
    assert('detachRemovedTab', App.tabs.list.length === beforeDetach - 1, ids());
    assert('noGhostLeft', !document.querySelector('.tab-ghost'));

    // 7) 关闭所有标签页 → 自动补一个空白页（不会把窗口关掉）
    const total = App.tabs.list.length;
    for (let i = 0; i < total; i++) {
      App.tabs.close(App.tabs.list[0].id, true);
      await sleep(300);
    }
    await sleep(300);
    assert('blankTabAfterCloseAll', App.tabs.list.length === 1 && !App.tabs.list[0].state.pdfDoc);

    const failed = Object.entries(out).filter(([, v]) => String(v).startsWith('FAIL'));
    out.result = failed.length ? 'FAILED: ' + failed.map(([k]) => k).join(',') : 'ALL PASS';
    return out;
  } catch (e) {
    return { error: String(e), stack: e && e.stack, out };
  }
})();
