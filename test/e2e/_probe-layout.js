/* 缩放两段式重排：点击瞬间耗时 vs 补齐耗时 */
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 400; i += 1) {
    if (window.App && App.state && App.state.pdfDoc && App.state.pages && App.state.pages.length) break;
    await wait(100);
  }
  await wait(3000);
  const st = App.state;
  const p0 = st.pages[0];
  const pLast = st.pages[st.pages.length - 1];
  const out = {};

  const sizeOf = (p) => (p.el ? Math.round(p.el.getBoundingClientRect().width) : 0);
  out.before = { p0: sizeOf(p0), pLast: sizeOf(pLast), zoom: Number(st.zoom.toFixed(3)) };

  // 单次缩放：同步耗时
  const t0 = performance.now();
  App.viewer.setZoom(st.zoom * 1.2);
  out.syncMs = Math.round(performance.now() - t0);
  out.rightAfterSync = { p0: sizeOf(p0), pLast: sizeOf(pLast) };
  await wait(500);
  out.after500 = { p0: sizeOf(p0), pLast: sizeOf(pLast), expect: Math.round(p0.wPt * st.zoom) };

  // 连点 5 次
  const t1 = performance.now();
  for (let i = 0; i < 5; i += 1) {
    App.viewer.setZoom(st.zoom * 1.05);
    await wait(40);
  }
  out.burstSyncMs = Math.round(performance.now() - t1);
  await wait(900);
  out.burstAfter = { p0: sizeOf(p0), pLast: sizeOf(pLast), expect: Math.round(p0.wPt * st.zoom) };

  // 缩放后立刻滚动（应触发 flush，位置正确）
  App.viewer.setZoom(st.zoom * 0.8);
  await wait(20);
  App.viewer.scrollToPage(300, false);
  await wait(1200);
  out.afterScroll = {
    currentPage: st.currentPage,
    p0: sizeOf(p0),
    pLast: sizeOf(pLast),
    expect: Math.round(p0.wPt * st.zoom),
    indexed: !!st._indexed,
  };
  return out;
})();
