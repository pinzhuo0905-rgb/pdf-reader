// 场景：多标签页 + 目录侧栏
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = App.state;
  for (let i = 0; i < 80 && !st.pdfDoc; i++) await sleep(150);
  await sleep(700);

  // 用示例 PDF 同目录下的第二个文档，保证脚本可移植
  const dir = (st.filePath || '').replace(/[\\/][^\\/]+$/, '');
  if (dir) {
    await App.tabs.openPath(dir + '/physics-notes.pdf');
    await sleep(900);
  }
  App.tabs.createBlank(false); // 第三个标签页：新标签页
  App.ui.toggleSidebar(); // 展开目录
  await sleep(1500);
  App.viewer.scrollToPage(1, false);
  await sleep(500);
  return { scene: 'tabs', tabs: App.tabs.list.length };
})();
