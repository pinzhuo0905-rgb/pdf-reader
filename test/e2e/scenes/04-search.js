// 场景：深色主题 + 全文搜索
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = App.state;
  for (let i = 0; i < 80 && !st.pdfDoc; i++) await sleep(150);
  await sleep(700);
  App.ui.applyTheme('dark');
  App.viewer.scrollToPage(0, false);
  await sleep(300);
  document.getElementById('btn-search').click();
  const input = document.getElementById('search-input');
  input.value = '硝化';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1500);
  return { scene: 'search', matches: st.search.matches.length };
})();
