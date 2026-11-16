/* 缩放后视点是否保持（partial layout 不能把当前位置弄丢） */
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 400; i += 1) {
    if (window.App && App.state && App.state.pdfDoc && App.state.pages && App.state.pages.length) break;
    await wait(100);
  }
  await wait(2500);
  const st = App.state;
  const out = {};

  const check = async (label, zoomFactor) => {
    App.viewer.scrollToPage(49, false);
    await wait(700);
    const view = App.viewer.getEl();
    view.scroll.scrollTop += 300;
    await wait(500);
    const p = st.pages[49];
    const before = { top: Math.round(p.el.getBoundingClientRect().top), scrollTop: Math.round(view.scroll.scrollTop) };
    App.viewer.setZoom(st.zoom * zoomFactor);
    await wait(800);
    const after = { top: Math.round(p.el.getBoundingClientRect().top), scrollTop: Math.round(view.scroll.scrollTop) };
    return { label, before, after, drift: after.top - before.top, current: st.currentPage };
  };

  out.zoomIn = await check('zoomIn', 1.25);
  out.zoomOut = await check('zoomOut', 0.8);

  // 双页模式下缩放
  App.viewer.setTwoUp(true);
  await wait(1200);
  const view = App.viewer.getEl();
  const p = st.pages[0];
  const b = Math.round(p.el.getBoundingClientRect().top);
  App.viewer.setZoom(st.zoom * 1.15);
  await wait(900);
  out.twoUp = {
    before: b,
    after: Math.round(p.el.getBoundingClientRect().top),
    width: Math.round(p.el.getBoundingClientRect().width),
    expect: Math.round(p.wPt * st.zoom),
  };
  App.viewer.setTwoUp(false);
  await wait(600);
  out.backToOne = { width: Math.round(p.el.getBoundingClientRect().width), expect: Math.round(p.wPt * st.zoom) };
  return out;
})();
