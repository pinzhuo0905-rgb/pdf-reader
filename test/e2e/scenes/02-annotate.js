// 场景：标注 + 编辑工具栏（用于 README 截图）
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = App.state;
  for (let i = 0; i < 80 && !st.pdfDoc; i++) await sleep(150);
  await sleep(700);
  App.viewer.scrollToPage(0, false);
  await sleep(300);

  const page = st.pages[0];
  const items = App.viewer.getTextItems(page.id);
  const W = page.wPt * st.zoom;
  const H = page.hPt * st.zoom;
  const at = (kw) => items.find((t) => t.str.includes(kw));

  // 两处高亮：标题 + 答案行
  for (const kw of ['氮循环的主要过程', 'Nitrification, performed']) {
    const it = at(kw);
    if (it) {
      App.annots.add(page.id, {
        type: 'highlight',
        rects: [{ x: it.left / W, y: it.top / H, w: it.width / W, h: (it.height * 1.18) / H }],
        color: '#ffe14d',
      });
    }
  }

  // 画笔（左侧空白处划重点）
  App.annots.add(page.id, {
    type: 'ink',
    points: [
      { x: 0.09, y: 0.276 },
      { x: 0.13, y: 0.29 },
      { x: 0.17, y: 0.277 },
      { x: 0.22, y: 0.288 },
    ],
    color: '#e81123',
    width: 3.5,
  });

  // 形状（框住「译文」那一行）
  const tr = at('译文');
  if (tr) {
    App.annots.add(page.id, {
      type: 'shape',
      kind: 'rect',
      x: tr.left / W - 0.008,
      y: tr.top / H - 0.004,
      w: tr.width / W + 0.016,
      h: (tr.height * 1.3) / H,
      color: '#0072c9',
      width: 2,
    });
  }

  // 文本框（批注）
  App.annots.add(page.id, {
    type: 'text',
    x: 0.56,
    y: 0.062,
    w: 0.4,
    h: 0.04,
    text: '批注：Ctrl+S 写进 PDF',
    size: 11,
    color: '#c0392b',
    align: 'left',
  });

  App.ui.setEditMode(true, true); // 静默进入，不弹提示
  App.ui.setTool('textedit');
  await sleep(1400);
  document.getElementById('toast').classList.add('hidden');
  await sleep(200);

  const pg = st.pages[0];
  return { scene: 'annotate', annots: App.annots.get(page.id).length, rendered: pg.rendered };
})();
