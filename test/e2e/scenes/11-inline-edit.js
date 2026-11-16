// 场景：页内原地编辑文字（不弹浮层）
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = App.state;
  for (let i = 0; i < 80 && !st.pdfDoc; i++) await sleep(150);
  App.i18n.setLang('en', { silent: true });
  await sleep(900);
  App.viewer.scrollToPage(0, false);
  await sleep(600);

  const page = st.pages[0];
  await App.viewer.ensureTextItems(page);
  const items = App.viewer.getTextItems(page.id);
  const it = items.find((x) => x.str && x.str.trim().length > 6) || items[0];
  if (it) {
    const pr = page.el.getBoundingClientRect();
    App.ui.setTool('textedit');
    await sleep(250);
    page.el.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: pr.left + it.left + it.width / 2,
        clientY: pr.top + it.top + it.height / 2,
        bubbles: true,
        button: 0,
      })
    );
    await sleep(600);
  }
  return { scene: 'inline-edit', editor: !!document.getElementById('textEditor') };
})();
