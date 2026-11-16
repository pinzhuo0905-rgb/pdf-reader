// 场景：双页视图（两页都渲染完成再截图）
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = App.state;
  for (let i = 0; i < 80 && !st.pdfDoc; i++) await sleep(150);
  App.i18n.setLang('en', { silent: true });
  await sleep(700);
  App.ui.setTool('select');
  App.viewer.setTwoUp(true);
  await sleep(1200);
  App.viewer.scrollToPage(0, false);
  for (let i = 0; i < 60; i++) {
    const a = st.pages[0];
    const b = st.pages[1];
    if (a && b && a.rendered && b.rendered) break;
    await sleep(120);
  }
  await sleep(700);
  return { scene: 'twoup', twoUp: !!st.twoUp };
})();
