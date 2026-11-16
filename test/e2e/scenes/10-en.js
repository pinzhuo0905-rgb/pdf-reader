// 场景：英文界面（README 需要展示 i18n）
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !App.state.pdfDoc; i++) await sleep(150);
  await sleep(700);
  App.i18n.setLang('en');
  App.ui.setTool('select');
  await sleep(900);
  App.viewer.scrollToPage(0, false);
  await sleep(700);
  return { scene: 'english', lang: App.i18n.lang };
})();
