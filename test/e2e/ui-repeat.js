/**
 * 重复性 / 压力用例：目录浮层与下拉菜单反复开关，
 * 用不同次数验证「不推挤文档、不重复堆积 DOM、层级正确、无运行时异常」。
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const S = () => App.state;
  const out = {};
  const runtimeErrors = [];
  window.addEventListener('error', (e) => runtimeErrors.push(String((e && e.message) || e.error)));
  window.addEventListener('unhandledrejection', (e) =>
    runtimeErrors.push('rejection: ' + String((e.reason && e.reason.message) || e.reason))
  );

  const assert = (name, ok, extra) => {
    out[name] = ok ? 'ok' : 'FAIL ' + JSON.stringify(extra === undefined ? null : extra);
  };

  for (let i = 0; i < 150 && !S().pdfDoc; i++) await sleep(100);
  await sleep(900);

  const page = S().pages[0];
  const base = page.el.getBoundingClientRect();
  const baseArea = $('views').querySelector('.view.active .scroll-area').clientWidth;
  const sb = $('sidebar');

  /* ---------- 1) 目录反复开关：20 / 7 / 3 次 ---------- */
  const rounds = [20, 7, 3];
  let drift = 0;
  let thumbCounts = new Set();
  for (const n of rounds) {
    for (let i = 0; i < n; i++) {
      App.viewer.toggleSidebar(true);
      await sleep(45);
      sb.getAnimations().forEach((a) => {
        try {
          a.finish();
        } catch (e) {}
      });
      const r = page.el.getBoundingClientRect();
      drift = Math.max(drift, Math.abs(r.left - base.left), Math.abs(r.width - base.width));
      thumbCounts.add(document.querySelectorAll('#thumbs .thumb').length);
      App.viewer.toggleSidebar(false);
      await sleep(25);
    }
  }
  assert('repeatSidebarNoDrift', drift < 1, +drift.toFixed(2));
  assert('repeatSidebarThumbsStable', thumbCounts.size === 1 && thumbCounts.has(S().pages.length), [...thumbCounts]);
  assert('repeatSidebarAreaStable', $('views').querySelector('.view.active .scroll-area').clientWidth === baseArea, [
    baseArea,
    $('views').querySelector('.view.active .scroll-area').clientWidth,
  ]);
  assert('repeatSidebarClosed', sb.classList.contains('hidden'));

  /* ---------- 2) 目录打开时叠加菜单：层级必须高于浮层 ---------- */
  App.viewer.toggleSidebar(true);
  await sleep(50);
  sb.getAnimations().forEach((a) => {
    try {
      a.finish();
    } catch (e) {}
  });
  $('btn-hl-caret').click();
  await sleep(80);
  const layer = $('menuLayer');
  const menuEl = layer.querySelector('.menu');
  const sbZ = parseInt(getComputedStyle(sb).zIndex, 10);
  const layerZ = parseInt(getComputedStyle(layer).zIndex, 10);
  assert('menuAboveSidebar', !!menuEl && layerZ > sbZ, [sbZ, layerZ]);
  layer.classList.add('hidden');
  layer.innerHTML = '';
  App.viewer.toggleSidebar(false);
  await sleep(60);

  /* ---------- 3) 三个下拉箭头各开 8 次 ---------- */
  const carets = ['btn-hl-caret', 'btn-draw-caret', 'btn-eraser-caret'];
  let opened = 0;
  let animated = 0;
  for (let i = 0; i < 8; i++) {
    for (const id of carets) {
      $(id).click();
      await sleep(45);
      const m = $('menuLayer').querySelector('.menu');
      if (m) {
        opened++;
        if (getComputedStyle(m).animationName === 'menu-in') animated++;
      }
      $('menuLayer').classList.add('hidden');
      $('menuLayer').innerHTML = '';
    }
  }
  assert('repeatCaretMenusOpen', opened === 24, opened);
  assert('repeatCaretMenusAnimated', animated === 24, animated);

  /* ---------- 4) 「更多」菜单开 12 次：条目数恒定、不累积 ---------- */
  const counts = new Set();
  for (let i = 0; i < 12; i++) {
    $('btn-more').click();
    await sleep(40);
    const m = $('menuLayer').querySelector('.menu');
    counts.add(m ? m.querySelectorAll('.menu-item').length : -1);
    $('menuLayer').classList.add('hidden');
    $('menuLayer').innerHTML = '';
  }
  assert('repeatMoreMenuStable', counts.size === 1 && !counts.has(-1) && !counts.has(0), [...counts]);

  /* ---------- 5) 侧栏开着时切换标签页 ---------- */
  App.viewer.toggleSidebar(true);
  await sleep(60);
  const beforeTabs = document.querySelectorAll('#thumbs .thumb').length;
  $('tab-new').click();
  await sleep(250);
  const blankThumbs = document.querySelectorAll('#thumbs .thumb').length;
  App.tabs.activate(App.tabs.list[0].id);
  await sleep(350);
  const backThumbs = document.querySelectorAll('#thumbs .thumb').length;
  assert('sidebarSurvivesTabSwitch', beforeTabs === S().pages.length && backThumbs === beforeTabs, [
    beforeTabs,
    blankThumbs,
    backThumbs,
  ]);
  App.viewer.toggleSidebar(false);
  await sleep(80);

  /* ---------- 6) 运行时异常 ---------- */
  const realErrors = runtimeErrors.filter((m) => !/RenderingCancelled|network service|GPU process|Clipboard/i.test(m));
  assert('noRuntimeErrors', realErrors.length === 0, realErrors.slice(0, 3));

  const failed = Object.entries(out).filter(([, v]) => String(v).startsWith('FAIL'));
  out.result = failed.length ? 'FAILED: ' + failed.map(([k]) => k).join(',') : 'ALL PASS';
  return out;
})();
