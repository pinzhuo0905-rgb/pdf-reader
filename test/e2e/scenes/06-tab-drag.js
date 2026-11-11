// 场景：拖拽标签页（拖离标签条时提示将生成独立窗口）
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = App.state;
  for (let i = 0; i < 80 && !st.pdfDoc; i++) await sleep(150);
  await sleep(600);

  const dir = (st.filePath || '').replace(/[\\/][^\\/]+$/, '');
  if (dir) {
    await App.tabs.openPath(dir + '/physics-notes.pdf');
    await sleep(900);
  }
  App.tabs.activate(App.tabs.list[0].id);
  await sleep(400);

  const el = document.querySelectorAll('#tabstrip .tab')[0];
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + r.width / 2);
  const y = Math.round(r.top + r.height / 2);
  el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, button: 0, buttons: 1 }));
  for (let i = 1; i <= 6; i++) {
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: x + i * 12, clientY: y + i * 42, bubbles: true, buttons: 1 })
    );
    await sleep(40);
  }
  // 故意不释放：截下拖拽中的浮影（虚线框表示松手会在新窗口打开）
  await sleep(300);
  return { scene: 'tab-drag', ghost: !!document.querySelector('.tab-ghost.detach') };
})();
