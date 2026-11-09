// 场景：OCR 识别结果
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = App.state;
  for (let i = 0; i < 80 && !st.pdfDoc; i++) await sleep(150);
  await sleep(700);
  App.viewer.scrollToPage(0, false);
  App.ocr.open();
  document.getElementById('ocr-lang').value = 'auto';
  await App.ocr.runPage();
  await sleep(500);
  return { scene: 'ocr', lines: st.ocr ? st.ocr.boxes.length : 0 };
})();
