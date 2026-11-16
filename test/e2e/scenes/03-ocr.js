// 场景：OCR 识别结果
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = App.state;
  for (let i = 0; i < 80 && !st.pdfDoc; i++) await sleep(150);
  App.i18n.setLang('en', { silent: true });
  await sleep(700);
  App.viewer.scrollToPage(0, false);
  App.ocr.open();
  document.getElementById('ocr-lang').value = 'auto';
  // 这里不跑真实识别：OCR 是主进程里的同步 CPU 推理，截图请求会排在它后面，
  // 无头环境下容易把整个截图流程拖死。面板本身 + 语言选择已经足够说明这块功能。
  await sleep(800);
  return { scene: 'ocr', panel: !document.getElementById('ocr-panel').classList.contains('hidden') };
})();
