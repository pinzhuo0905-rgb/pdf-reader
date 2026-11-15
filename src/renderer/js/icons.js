/* 线性图标集（20x20 视口，1.2px 描边）
 * 设计约定：
 *  - 除「保存 / 另存为 / 橡皮 / 撤销 / 重做」外，所有图形都关于 x=10 中轴对称；
 *    撤销/重做本身就是左右指向的箭头，做成对称就失去含义，所以保留方向、只保证居中。
 *  - 描边统一 1.2，圆头圆角，视觉重量比旧版（1.4）更轻。
 */
(function () {
  'use strict';

  const SW = 1.2;
  const P = (d, extra = '') =>
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const R = (x, y, w, h, rx = 1.4, extra = '') =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="currentColor" stroke-width="${SW}" ${extra}/>`;

  const ICONS = {
    // 三条等长居中横线
    menu: P('M3.7 5.4h12.6M3.7 10h12.6M3.7 14.6h12.6'),
    // 撤销 / 重做：左右指向，互为镜像，保持居中
    undo: `${P('M7.6 6.2 4.1 9.7l3.5 3.5')}${P('M4.1 9.7h7.2a3.5 3.5 0 0 1 0 7h-1.8')}`,
    redo: `${P('M12.4 6.2 15.9 9.7l-3.5 3.5')}${P('M15.9 9.7H8.7a3.5 3.5 0 0 0 0 7h1.8')}`,
    // 荧光笔：对称的笔尖（色条 + 梯形笔身 + 底线）
    highlight: `
      <rect x="4.6" y="3" width="10.8" height="2.4" rx="0.8" fill="currentColor" stroke="none"/>
      ${P('M6.9 5.4h6.2l-1.5 5.4H8.4z')}
      ${P('M5.4 15.4h9.2')}`,
    // 绘制：同一形状实心（取强调色）
    draw: `
      <rect class="accent-fill" x="4.6" y="3" width="10.8" height="2.4" rx="0.8" fill="currentColor" stroke="none"/>
      <path class="accent-fill" d="M6.9 5.4h6.2l-1.5 5.4H8.4z" fill="currentColor" stroke="currentColor" stroke-width="${SW}" stroke-linejoin="round"/>
      ${P('M5.4 15.4h9.2')}`,
    // 橡皮：斜放 + 底线，按用户要求保留非对称
    eraser: `<g transform="rotate(-38 10 10)"><rect x="3.6" y="7.4" width="12.8" height="5.6" rx="1.6" fill="none" stroke="currentColor" stroke-width="${SW}"/><path d="M10 7.4v5.6" stroke="currentColor" stroke-width="${SW}" stroke-linecap="round"/></g>${P('M4.2 16.9h11.6')}`,
    // 文本框：居中 T
    textBox: `${R(2.8, 4.4, 14.4, 11.2, 2.1)}${P('M6.6 8.2h6.8M10 8.2v4.2')}`,
    // 更多：三个等距圆点
    more: `
      <circle cx="4.4" cy="10" r="1.35" fill="currentColor"/>
      <circle cx="10" cy="10" r="1.35" fill="currentColor"/>
      <circle cx="15.6" cy="10" r="1.35" fill="currentColor"/>`,
    minus: P('M4.6 10h10.8'),
    plus: `${P('M4.6 10h10.8')}${P('M10 4.6v10.8')}`,
    // 适应宽度：方框 + 对称双向箭头
    fitWidth: `${R(2.8, 5.8, 14.4, 8.4, 1.8)}${P('M6.6 10h6.8M8.4 8.2 6.6 10l1.8 1.8M11.6 8.2 13.4 10l-1.8 1.8')}`,
    // 旋转：两个弧形箭头首尾相接，绕成一个闭环（顺时针）
    rotate: `${P('M14.6 7.4A5.2 5.2 0 0 0 5.4 7.4')}${P('M5.4 7.4l2.2.7M5.4 7.4l.7-2.2')}${P('M5.4 12.6A5.2 5.2 0 0 0 14.6 12.6')}${P('M14.6 12.6l-2.2-.7M14.6 12.6l-.7 2.2')}`,
    // 双页：两页等宽等高
    twoPage: `${R(2.5, 4.8, 6.6, 10.4, 1.3)}${R(10.9, 4.8, 6.6, 10.4, 1.3)}`,
    // 搜索：圆 + 垂直握柄，保证中轴对称
    search: `<circle cx="10" cy="8.7" r="5" fill="none" stroke="currentColor" stroke-width="${SW}"/>${P('M10 13.7v3.2')}`,
    // 打印：纸/机身/出纸口都居中
    print: `${P('M6.4 7.2V3.9h7.2v3.3')}${R(3.4, 7.2, 13.2, 5.8, 1.5)}${R(6.4, 11.4, 7.2, 4.6, 0.9)}`,
    // 保存：软盘，按用户要求保留非对称
    save: `${P('M3.9 5.5a1.7 1.7 0 0 1 1.7-1.7h7.6l2.9 2.9v7.8a1.7 1.7 0 0 1-1.7 1.7H5.6a1.7 1.7 0 0 1-1.7-1.7z')}${P('M6.8 3.8h4.9v3.4H6.8zM6.8 11.2h6.4v5.1H6.8z')}`,
    // 另存为：软盘 + 居中的向上箭头（对称）
    saveAs: `${P('M4.4 7.4a1.7 1.7 0 0 1 1.7-1.7h7.6l2.4 2.4v7.5a1.7 1.7 0 0 1-1.7 1.7H6.1a1.7 1.7 0 0 1-1.7-1.7z')}${P('M7.3 5.7h4.6v3.1H7.3z')}${P('M10 2.2v4.4M8 4.2 10 2.2l2 2')}`,
    // 全屏：四角箭头，对称
    expand: `${P('M11.6 3.9h4.5v4.5M8.4 16.1H3.9v-4.5')}${P('M16.1 3.9 11.4 8.6M3.9 16.1 8.6 11.4')}`,
    // 设置：齿轮，对称
    settings: `<path d="M8.55 2.9h2.9l.38 1.86c.46.16.9.37 1.3.62l1.74-.72 1.45 2.5-1.4 1.3c.05.34.08.7.08 1.04 0 .34-.03.7-.08 1.04l1.4 1.3-1.45 2.5-1.74-.72c-.4.25-.84.46-1.3.62l-.38 1.86h-2.9l-.38-1.86a5.9 5.9 0 0 1-1.3-.62l-1.74.72-1.45-2.5 1.4-1.3A5.9 5.9 0 0 1 4.9 10c0-.34.03-.7.08-1.04l-1.4-1.3 1.45-2.5 1.74.72c.4-.25.84-.46 1.3-.62z" fill="none" stroke="currentColor" stroke-width="${SW}" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="${SW}"/>`,
    chevronDown: P('M6.4 8.5 10 12.1l3.6-3.6'),
    chevronUp: P('M6.4 11.5 10 7.9l3.6 3.6'),
    chevronLeft: P('M11.6 6.4 7.9 10l3.7 3.6'),
    chevronRight: P('M8.4 6.4 12.1 10l-3.7 3.6'),
    close: P('M5.8 5.8 14.2 14.2M14.2 5.8 5.8 14.2'),
    cursor: `<path d="M5.9 3.6 7.1 15.2l2.5-2.9 2 3.4 1.6-.9-2-3.3 3.7-.4z" fill="none" stroke="currentColor" stroke-width="${SW}" stroke-linejoin="round"/>`,
    editText: `${P('M3.9 5.9h7.4M7.6 5.9v8.2M5.9 14.1h3.4')}${P('m12.4 16.4.4-2 3.4-3.4 1.6 1.6-3.4 3.4z')}`,
    image: `${R(2.9, 4.5, 14.2, 11, 1.8)}<circle cx="7.1" cy="8.4" r="1.35" fill="none" stroke="currentColor" stroke-width="${SW}"/>${P('m4.4 14.6 4-4 3.2 3.2 2.1-2.1 2.3 2.3')}`,
    shapes: `${R(2.7, 2.7, 7.6, 7.6, 1.3)}<circle cx="13.7" cy="13.7" r="3.8" fill="none" stroke="currentColor" stroke-width="${SW}"/>`,
    whiteout: `<rect x="3.2" y="4.2" width="13.6" height="11.6" rx="1.6" fill="none" stroke="currentColor" stroke-width="${SW}" stroke-dasharray="3 2.2"/>${P('M6.8 10h6.4')}`,
    palette: `${P('M10 3.4a6.6 6.6 0 1 0 0 13.2c1 0 1.6-.7 1.6-1.6 0-1.5 1-2.2 2.2-2.2h.6a2.3 2.3 0 0 0 2.3-2.3c0-3.9-3.4-7.1-6.7-7.1z')}<circle cx="7.3" cy="8.1" r="1.05" fill="currentColor"/><circle cx="10" cy="6.6" r="1.05" fill="currentColor"/><circle cx="12.7" cy="8.3" r="1.05" fill="currentColor"/>`,
    // OCR：四角框 + 三行居中文字
    ocr: `${P('M3.6 6.8V5.1a1.5 1.5 0 0 1 1.5-1.5h1.7M13.2 3.6h1.7a1.5 1.5 0 0 1 1.5 1.5v1.7M3.6 13.2v1.7a1.5 1.5 0 0 0 1.5 1.5h1.7M13.2 16.4h1.7a1.5 1.5 0 0 0 1.5-1.5v-1.7')}${P('M6.6 7.6h6.8M6.6 10.1h6.8M6.6 12.6h4.2')}`,
    winMin: `<path d="M4.4 10h11.2" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>`,
    winMax: `<rect x="4.8" y="4.8" width="10.4" height="10.4" fill="none" stroke="currentColor" stroke-width="1"/>`,
    winRestore: `<rect x="4.1" y="6.8" width="9.1" height="9.1" fill="none" stroke="currentColor" stroke-width="1"/><path d="M6.9 6.8V4.1h9v9h-2.7" fill="none" stroke="currentColor" stroke-width="1"/>`,
    winClose: `<path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round"/>`,
    check: P('M4.8 10.3 8.3 13.8l6.9-7.6'),
    file: `${P('M5.2 3.1h5.9L14.8 6.7v10.2H5.2z')}${P('M11 3.1v3.7h3.8')}`,
    info: `<circle cx="10" cy="10" r="7.1" fill="none" stroke="currentColor" stroke-width="${SW}"/>${P('M10 9.1v4.3')}<circle cx="10" cy="6.6" r=".85" fill="currentColor"/>`,
    zoomFit: P('M4.2 7.7V4.2h3.5M15.8 12.3v3.5h-3.5M4.2 12.3v3.5h3.5M15.8 7.7V4.2h-3.5'),
  };

  function svg(name, cls = '') {
    const body = ICONS[name] || '';
    return `<svg class="ic ${cls}" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">${body}</svg>`;
  }

  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      const name = el.getAttribute('data-icon');
      if (el.querySelector('svg.ic')) return;
      el.insertAdjacentHTML('afterbegin', svg(name));
    });
  }

  window.Icons = { ICONS, svg, hydrate };
})();
