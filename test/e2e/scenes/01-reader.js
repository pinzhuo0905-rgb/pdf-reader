// 场景：干净的阅读界面
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80 && !App.state.pdfDoc; i++) await sleep(150);
  await sleep(700);
  App.viewer.scrollToPage(0, false);
  App.ui.setTool('select');
  window.getSelection().removeAllRanges();
  await sleep(400);
  return { scene: 'reader' };
})();
