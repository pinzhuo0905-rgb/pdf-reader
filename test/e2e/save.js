/* 保存回归：保存后不跳页、撤销栈保留、重复保存不重复写入、撤销后保存能改回文件 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const assert = (k, ok, extra) => {
    out[k] = ok ? 'ok' : 'FAIL' + (extra === undefined ? '' : ' ' + JSON.stringify(extra));
  };

  try {
    for (let i = 0; i < 150 && !App.state.pdfDoc; i++) await sleep(100);
    await sleep(700);

    const srcPath = App.state.filePath;
    const dir = srcPath.replace(/[\\/][^\\/]+$/, '');
    const tmp = dir + '/.tmp-save.pdf';
    // 用应用自己的 API 复制一份，避免改动 fixtures 里的原文件
    const srcBytes = await window.api.readFile(srcPath);
    await window.api.save(tmp, new Uint8Array(srcBytes.data));

    const yellow = async (pageNo) => {
      const res = await window.api.readFile(tmp);
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(res.data).slice(0) }).promise;
      const pg = await doc.getPage(pageNo);
      const vp = pg.getViewport({ scale: 1 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 190 && d[i + 2] < 190) n++;
      return n;
    };

    await App.tabs.openPath(tmp);
    await sleep(1500);
    const page = App.state.pages[2];
    App.viewer.scrollToPage(2, false);
    await sleep(700);
    const top0 = Math.round(App.viewer.getEl().scroll.scrollTop);
    const hist0 = App.state.history.length;
    const baseYellow = await yellow(3);

    App.annots.add(page.id, { type: 'highlight', rects: [{ x: 0.1, y: 0.2, w: 0.4, h: 0.04 }], color: '#ffe14d' });
    await sleep(250);
    await App.ui.save(false);
    await sleep(600);

    assert('pageKept', App.state.currentPage === 2, App.state.currentPage + 1);
    assert('scrollKept', Math.abs(App.viewer.getEl().scroll.scrollTop - top0) < 4, [top0, Math.round(App.viewer.getEl().scroll.scrollTop)]);
    assert('historyKept', App.state.history.length === hist0 + 1, [hist0, App.state.history.length]);
    assert('annotsKept', App.annots.get(page.id).length === 1);
    assert('dirtyCleared', App.state.dirty === false);

    const y1 = await yellow(3);
    assert('written', y1 > baseYellow, [baseYellow, y1]);

    await App.ui.save(false);
    await sleep(500);
    const y2 = await yellow(3);
    assert('noDuplicate', y2 === y1, [y1, y2]);

    App.history.undo();
    await sleep(400);
    assert('undoAfterSave', App.annots.get(page.id).length === 0);
    await App.ui.save(false);
    await sleep(600);
    const y3 = await yellow(3);
    assert('undoSavedToFile', Math.abs(y3 - baseYellow) <= 20, [baseYellow, y3]);
    assert('pageStillKept', App.state.currentPage === 2, App.state.currentPage + 1);

    // 收尾：关掉临时标签页
    const tmpTab = App.tabs.list.find((t) => t.state.filePath === tmp);
    if (tmpTab) {
      App.tabs.close(tmpTab.id, true);
      await sleep(500);
    }

    const failed = Object.entries(out).filter(([, v]) => String(v).startsWith('FAIL'));
    out.result = failed.length ? 'FAILED: ' + failed.map(([k]) => k).join(',') : 'ALL PASS';
    return out;
  } catch (e) {
    return { error: String(e), stack: (e && e.stack || '').split('\n').slice(0, 3).join(' | '), out };
  }
})();
