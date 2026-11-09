// 端到端自检：OCR 整页识别 + 语言模式 + 插入文本框 + 导出 PDF
// 用法：PDFREADER_TEST=test/e2e/ocr.js npx electron . test/fixtures/sample.pdf
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = App.state;
  const out = {};
  try {
    for (let i = 0; i < 80 && !st.pdfDoc; i++) await sleep(150);
    await sleep(500);

    App.ocr.open();
    const sel = document.getElementById('ocr-lang');
    out.langOptions = Array.from(sel.options).map((o) => o.value);

    // 整页识别（自动语种）
    sel.value = 'auto';
    await App.ocr.runPage();
    out.lines = st.ocr ? st.ocr.boxes.length : 0;
    out.status = document.getElementById('ocr-status').textContent;
    out.firstLines = st.ocr ? st.ocr.boxes.slice(0, 3).map((b) => b.text) : [];

    // 框选区域识别
    const page = st.pages[0];
    const pageLines = st.ocr ? st.ocr.boxes.length : 0;
    const rect = page.el.getBoundingClientRect();
    App.ocr.startRegionSelect();
    await sleep(100);
    const pe = (type, x, y) =>
      new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true });
    const x0 = rect.left + rect.width * 0.08;
    const y0 = rect.top + rect.height * 0.42;
    const x1 = rect.left + rect.width * 0.9;
    const y1 = rect.top + rect.height * 0.6;
    page.el.dispatchEvent(pe('pointerdown', x0, y0));
    await sleep(60);
    window.dispatchEvent(pe('pointermove', x1, y1));
    await sleep(60);
    window.dispatchEvent(pe('pointerup', x1, y1));
    // 等区域识别覆盖掉上一次的整页结果
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      if (st.ocr && st.ocr.boxes.length !== pageLines) break;
    }
    out.regionLines = st.ocr ? st.ocr.boxes.length : 0;
    out.allInsideRegion = st.ocr
      ? st.ocr.boxes.every((b) => b.y >= 0.40 && b.y <= 0.63)
      : false;

    // 插入文本框（页面上已有文字层时会弹确认框，这里直接调用确认）
    const before = App.annots.get(page.id).length;
    document.getElementById('ocr-insert').click();
    await sleep(300);
    const modal = document.getElementById('modal');
    if (!modal.classList.contains('hidden')) {
      const btns = modal.querySelectorAll('#modal-foot button');
      btns[btns.length - 1].click();
      await sleep(400);
    }
    out.inserted = App.annots.get(page.id).length - before;

    // 导出 PDF
    const t0 = performance.now();
    const bytes = await App.exporter.build();
    out.exportMs = Math.round(performance.now() - t0);
    out.pdfBytes = bytes.length;
    return out;
  } catch (e) {
    return { error: String(e), stack: e && e.stack, out };
  }
})();
