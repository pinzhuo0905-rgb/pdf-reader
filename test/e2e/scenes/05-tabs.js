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
  App.ui.toggleSidebar(); // 展开目录（浮层）
  await sleep(120);
  // 隐藏窗口里 CSS 动画不推进，截图前快进到终态
  document.getElementById('sidebar').getAnimations().forEach((a) => {
    try { a.finish(); } catch (e) {}
  });
  await sleep(1200);
  App.viewer.scrollToPage(1, false);
  // 等目标页真正画出来再截图，否则可能截到空白画布
  for (let i = 0; i < 60; i++) {
    const p = App.state.pages[1];
    if (p && p.rendered) break;
    await sleep(100);
  }
  await sleep(600);
  return { scene: 'tabs', tabs: App.tabs.list.length };
})();
