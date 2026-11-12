/**
 * 自检：窗口标题栏（自绘按钮 + 标签同一行）与多标签排布
 *
 * 覆盖：
 * - 三个窗口按钮与标签条在同一行、贴右边缘、互不覆盖
 * - 标签数量增加时均分收窄，标签之间不重叠、不压住「+」和窗口按钮
 * - 最大化 / 还原切换与图标变化
 *
 * 运行：npm run test:chrome
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const assert = (name, ok, extra) => {
    out[name] = ok ? 'ok' : 'FAIL' + (extra === undefined ? '' : ' ' + JSON.stringify(extra));
  };

  const geo = () => {
    const strip = document.getElementById('tabstrip');
    const tabs = [...strip.querySelectorAll('.tab')].map((t) => {
      const b = t.getBoundingClientRect();
      return { x: Math.round(b.x), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) };
    });
    const overlaps = [];
    for (let i = 1; i < tabs.length; i++) if (tabs[i].x < tabs[i - 1].r) overlaps.push(i);
    const ctrl = document.getElementById('win-controls').getBoundingClientRect();
    const plus = document.getElementById('tab-new').getBoundingClientRect();
    const bar = document.getElementById('tabbar').getBoundingClientRect();
    return { tabs, overlaps, ctrl, plus, bar, strip };
  };

  try {
    for (let i = 0; i < 100 && !App.state.pdfDoc; i++) await sleep(120);
    await sleep(700);

    // 1) 窗口按钮与标签同一行、贴右
    let g = geo();
    const ctrl = g.ctrl;
    assert('controlsInSameRow', Math.abs(ctrl.top - g.bar.top) < 1 && ctrl.height === g.bar.height, {
      ctrlTop: ctrl.top,
      barTop: g.bar.top,
      ctrlH: ctrl.height,
      barH: g.bar.height,
    });
    assert('controlsFlushRight', Math.abs(ctrl.right - g.bar.right) < 1);
    const btns = ['win-min', 'win-max', 'win-close'].map((id) => document.getElementById(id).getBoundingClientRect());
    assert('threeButtonsEqualWidth', btns.every((b) => Math.abs(b.width - 46) < 1) && btns[2].right === ctrl.right);

    // 2) 标签不压住「+」与窗口按钮
    assert('tabsBeforePlus', g.tabs.every((t) => t.r <= Math.round(g.plus.x) + 1), {
      lastTabRight: g.tabs[g.tabs.length - 1].r,
      plusX: Math.round(g.plus.x),
    });
    assert('plusBeforeControls', Math.round(g.plus.right) <= Math.round(ctrl.x) + 1, {
      plusRight: Math.round(g.plus.right),
      ctrlX: Math.round(ctrl.x),
    });

    // 3) 加到 12 个标签：均分收窄、无重叠、不溢出到按钮
    while (App.tabs.list.length < 12) App.tabs.createBlank(false);
    await sleep(500);
    g = geo();
    assert('twelveNoOverlap', g.overlaps.length === 0, g.overlaps);
    assert('twelveSameWidth', new Set(g.tabs.map((t) => t.w)).size === 1, g.tabs.map((t) => t.w));
    assert('twelveFits', g.strip.scrollWidth <= g.strip.clientWidth + 2, {
      sw: g.strip.scrollWidth,
      cw: g.strip.clientWidth,
    });
    assert('twelveNotOverControls', g.tabs.every((t) => t.r <= Math.round(ctrl.x)), {
      lastTabRight: g.tabs[g.tabs.length - 1].r,
      ctrlX: Math.round(ctrl.x),
    });
    assert('twelveSameHeight', new Set(g.tabs.map((t) => t.h)).size <= 2, g.tabs.map((t) => t.h));

    // 4) 30 个标签：收到最小宽度后横向滚动，仍不重叠
    while (App.tabs.list.length < 30) App.tabs.createBlank(false);
    await sleep(500);
    g = geo();
    assert('thirtyNoOverlap', g.overlaps.length === 0, g.overlaps);
    assert('thirtyMinWidth', Math.min(...g.tabs.map((t) => t.w)) >= 72);
    assert('thirtyNarrowClass', document.getElementById('tabstrip').classList.contains('narrow'));

    // 5) 关闭多余标签，宽度恢复
    while (App.tabs.list.length > 2) App.tabs.close(App.tabs.list[App.tabs.list.length - 1].id, true);
    await sleep(500);
    g = geo();
    assert('widthRestored', g.tabs.every((t) => t.w === 208), g.tabs.map((t) => t.w));

    // 6) 最大化 / 还原
    const before = await window.api.isMaximized();
    document.getElementById('win-max').click();
    await sleep(800);
    const maxed = await window.api.isMaximized();
    const iconAfterMax = document.querySelector('#win-max').innerHTML;
    document.getElementById('win-max').click();
    await sleep(800);
    const restored = await window.api.isMaximized();
    const iconAfterRestore = document.querySelector('#win-max').innerHTML;
    assert('maximizeToggle', before === false && maxed === true && restored === false, { before, maxed, restored });
    assert('iconSwitches', iconAfterMax !== iconAfterRestore);

    const failed = Object.entries(out).filter(([, v]) => String(v).startsWith('FAIL'));
    out.result = failed.length ? 'FAILED: ' + failed.map(([k]) => k).join(',') : 'ALL PASS';
    return out;
  } catch (e) {
    return { error: String(e), stack: e && e.stack, out };
  }
})();
