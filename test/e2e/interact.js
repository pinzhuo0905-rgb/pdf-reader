// 端到端自检：文本选择 / 高亮 / 画笔 / 文本框 / 橡皮 / 撤销重做 / 旋转
// 用法：PDFREADER_TEST=test/e2e/interact.js npx electron . test/fixtures/sample.pdf
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = App.state;
  const log = {};
  try {
    for (let i = 0; i < 80 && !st.pdfDoc; i++) await sleep(150);
    await sleep(500);

    const page = st.pages[0];
    const rect = page.el.getBoundingClientRect();
    const W = page.wPt * st.zoom;
    const H = page.hPt * st.zoom;
    const ev = (type, x, y) => {
      const target = document.elementFromPoint(x, y) || page.el;
      target.dispatchEvent(
        new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true })
      );
    };

    // 1) 文本选择
    const spans = Array.from(document.querySelectorAll('.page .textLayer span')).filter(
      (s) => s.textContent.trim().length > 2
    );
    log.spans = spans.length;
    log.userSelect = getComputedStyle(spans[0]).userSelect;
    const range = document.createRange();
    range.setStart(spans[0], 0);
    range.setEnd(spans[1], spans[1].childNodes.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    log.selection = String(sel.toString()).slice(0, 40);

    // 2) 高亮（按文字行吸附）
    const items = App.viewer.getTextItems(page.id);
    const line = items.find((t) => t.str.length > 10) || items[0];
    const y = rect.top + line.top + line.height * 0.5;
    App.ui.setTool('highlight');
    ev('pointerdown', rect.left + line.left + 2, y);
    ev('pointermove', rect.left + line.left + line.width * 0.6, y);
    ev('pointermove', rect.left + line.left + line.width - 2, y);
    ev('pointerup', rect.left + line.left + line.width - 2, y);
    await sleep(150);
    log.highlight = App.annots.get(page.id).filter((a) => a.type === 'highlight').length;

    // 3) 画笔
    App.ui.setTool('draw');
    const dy = rect.top + H * 0.42;
    ev('pointerdown', rect.left + W * 0.2, dy);
    ev('pointermove', rect.left + W * 0.3, dy + 28);
    ev('pointermove', rect.left + W * 0.4, dy - 8);
    ev('pointerup', rect.left + W * 0.4, dy - 8);
    await sleep(150);
    log.ink = App.annots.get(page.id).filter((a) => a.type === 'ink').length;

    // 4) 文本框
    App.ui.setTool('textbox');
    ev('pointerdown', rect.left + W * 0.22, rect.top + H * 0.72);
    await sleep(200);
    log.editorOpened = !document.getElementById('textEditor').classList.contains('hidden');
    document.getElementById('textEditorInput').value = 'E2E 测试文本';
    document.getElementById('te-ok').click();
    await sleep(200);
    log.text = App.annots.get(page.id).filter((a) => a.type === 'text').length;

    // 5) 橡皮擦（点在画笔线的中间节点上）
    App.ui.setTool('eraser');
    await sleep(150);
    const inkAnnot = App.annots.get(page.id).find((a) => a.type === 'ink');
    const mid = inkAnnot.points[Math.floor(inkAnnot.points.length / 2)];
    const r2 = page.el.getBoundingClientRect();
    ev('pointerdown', r2.left + r2.width * mid.x, r2.top + r2.height * mid.y);
    await sleep(200);
    log.inkAfterErase = App.annots.get(page.id).filter((a) => a.type === 'ink').length;

    // 6) 撤销 / 重做
    const before = App.annots.get(page.id).length;
    App.history.undo();
    await sleep(150);
    const afterUndo = App.annots.get(page.id).length;
    App.history.redo();
    await sleep(150);
    log.undoRedo = [before, afterUndo, App.annots.get(page.id).length];

    // 7) 旋转 + 撤销
    const rot0 = st.pages[0].rot;
    App.viewer.rotatePage(0, 90);
    await sleep(300);
    const rot1 = st.pages[0].rot;
    App.history.undo();
    await sleep(300);
    log.rotate = [rot0, rot1, st.pages[0].rot];

    App.ui.setTool('select');
    return log;
  } catch (e) {
    return { error: String(e), stack: e && e.stack, log };
  }
})();
