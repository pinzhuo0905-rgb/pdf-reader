/* Edge 风格线性图标集（20x20 视口，1.4px 描边） */
(function () {
  const P = (d, extra = '') =>
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;

  const ICONS = {
    menu: `
      <circle cx="3.9" cy="5" r="1.05" fill="currentColor"/>
      <circle cx="3.9" cy="10" r="1.05" fill="currentColor"/>
      <circle cx="3.9" cy="15" r="1.05" fill="currentColor"/>
      ${P('M7.6 5h8.8M7.6 10h8.8M7.6 15h8.8')}`,
    undo: `${P('M7.4 5.9 3.9 9.4l3.5 3.5')}${P('M3.9 9.4h7.3a3.6 3.6 0 0 1 0 7.2H9.4')}`,
    redo: `${P('M12.6 5.9 16.1 9.4l-3.5 3.5')}${P('M16.1 9.4H8.8a3.6 3.6 0 0 0 0 7.2H10.6')}`,
    highlight: `
      <rect class="hl-bar" x="4.5" y="2.7" width="11.0" height="2.5" rx="0.7" fill="currentColor" stroke="none"/>
      ${P('M6.1 5.6h7.8v3.5l-1.7 3.1H7.8l-1.7-3.1z')}`,
    draw: `
      <rect class="accent-fill" x="4.5" y="2.7" width="11.0" height="2.5" rx="0.7" fill="currentColor" stroke="none"/>
      <path class="accent-fill" d="M6.1 5.6h7.8v3.5l-1.7 3.1H7.8l-1.7-3.1z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
    eraser: `<g transform="rotate(-38 10 10)"><rect x="3.4" y="7.3" width="13.2" height="5.8" rx="1.7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 7.3v5.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></g>${P('M4.0 17.0h12.0')}`,
    textBox: `<rect x="2.7" y="4.3" width="14.6" height="11.4" rx="2.1" fill="none" stroke="currentColor" stroke-width="1.4"/>${P('M6.5 8.1h7M10 8.1v4.4')}`,
    readAloud: `${P('M3.2 14.3 6.6 5.9l3.4 8.4M4.5 11.4h4.2')}${P('M13.2 8.3a4.6 4.6 0 0 1 0 5.4')}${P('M15.6 6.5a7.2 7.2 0 0 1 0 9')}`,
    more: `
      <text x="0.9" y="14.7" font-size="11.4" font-family="'Segoe UI',sans-serif" fill="currentColor">a</text>
      <text x="8.6" y="14.7" font-size="11.4" font-family="'Segoe UI',sans-serif" fill="currentColor">ö</text>`,
    minus: P('M4.2 10h11.6'),
    plus: `${P('M4.2 10h11.6')}${P('M10 4.2v11.6')}`,
    fitWidth: `<rect x="2.6" y="5.7" width="14.8" height="8.6" rx="1.7" fill="none" stroke="currentColor" stroke-width="1.4"/>${P('M6.5 10h7M8.3 8.2 6.5 10l1.8 1.8M11.7 8.2 13.5 10l-1.8 1.8')}`,
    rotate: `${P('M16.5 10a6.5 6.5 0 1 1-2.2-4.9')}${P('M16.7 3.5v3.4h-3.4')}`,
    twoPage: `<rect x="2.3" y="4.6" width="7" height="10.8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="10.7" y="4.6" width="7" height="10.8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
    search: `<circle cx="8.9" cy="8.9" r="5.2" fill="none" stroke="currentColor" stroke-width="1.4"/>${P('M12.8 12.8 17 17')}`,
    print: `${P('M6.2 7.6V3.6h7.6v4')}<rect x="3.2" y="7.6" width="13.6" height="6.2" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/>${P('M6.2 12.4h7.6v4.2H6.2z')}`,
    save: `${P('M3.7 5.4a1.7 1.7 0 0 1 1.7-1.7h7.9l3 3v7.9a1.7 1.7 0 0 1-1.7 1.7H5.4a1.7 1.7 0 0 1-1.7-1.7z')}${P('M6.6 3.7h5.1v3.5H6.6zM6.6 11.1h6.8v5.2H6.6z')}`,
    saveAs: `${P('M3.4 5.3a1.6 1.6 0 0 1 1.6-1.6h7l2.4 2.4v4.2')}${P('M3.4 5.3v9.4a1.6 1.6 0 0 0 1.6 1.6h4.4')}${P('M6.2 3.7h4.5v3.2H6.2z')}${P('m12.3 16.7.4-2.1 3.6-3.6 1.7 1.7-3.6 3.6z')}`,
    expand: `${P('M11.4 3.7h4.9v4.9M8.6 16.3H3.7v-4.9')}${P('M16.3 3.7 11.3 8.7M3.7 16.3 8.7 11.3')}`,
    settings: `<path d="M8.55 2.9h2.9l.38 1.86c.46.16.9.37 1.3.62l1.74-.72 1.45 2.5-1.4 1.3c.05.34.08.7.08 1.04 0 .34-.03.7-.08 1.04l1.4 1.3-1.45 2.5-1.74-.72c-.4.25-.84.46-1.3.62l-.38 1.86h-2.9l-.38-1.86a5.9 5.9 0 0 1-1.3-.62l-1.74.72-1.45-2.5 1.4-1.3A5.9 5.9 0 0 1 4.9 10c0-.34.03-.7.08-1.04l-1.4-1.3 1.45-2.5 1.74.72c.4-.25.84-.46 1.3-.62z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.15" fill="none" stroke="currentColor" stroke-width="1.35"/>`,
    chevronDown: P('M6.2 8.4 10 12.2l3.8-3.8'),
    chevronUp: P('M6.2 11.6 10 7.8l3.8 3.8'),
    close: P('M5.6 5.6 14.4 14.4M14.4 5.6 5.6 14.4'),
    cursor: `<path d="M5.7 3.4 7 15.3l2.6-3 2.1 3.5 1.7-.9-2.1-3.4 3.8-.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
    editText: `${P('M3.6 5.7h8.4M7.8 5.7v8.6M6 14.3h3.6')}${P('m12.6 16.7.4-2.1 3.6-3.6 1.7 1.7-3.6 3.6z')}`,
    image: `<rect x="2.8" y="4.4" width="14.4" height="11.2" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="8.3" r="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/>${P('m4.3 14.6 4.1-4.1 3.3 3.3 2.2-2.2 2.3 2.3')}`,
    shapes: `<rect x="2.6" y="2.6" width="7.8" height="7.8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="13.7" cy="13.7" r="3.9" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
    whiteout: `<rect x="3" y="4" width="14" height="12" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3.2 2.4"/>${P('M6.4 10h7.2')}`,
    palette: `${P('M10 3.2a6.8 6.8 0 1 0 0 13.6c1 0 1.6-.7 1.6-1.6 0-1.5 1-2.2 2.2-2.2h.6a2.4 2.4 0 0 0 2.4-2.4c0-4-3.5-7.4-6.8-7.4z')}<circle cx="7.2" cy="8" r="1.1" fill="currentColor"/><circle cx="10" cy="6.4" r="1.1" fill="currentColor"/><circle cx="12.8" cy="8.2" r="1.1" fill="currentColor"/>`,
    ocr: `${P('M3.4 6.6V4.9a1.5 1.5 0 0 1 1.5-1.5h1.7M13.4 3.4h1.7a1.5 1.5 0 0 1 1.5 1.5v1.7M3.4 13.4v1.7a1.5 1.5 0 0 0 1.5 1.5h1.7M13.4 16.6h1.7a1.5 1.5 0 0 0 1.5-1.5v-1.7')}${P('M6.4 7.4h7.2M6.4 10h7.2M6.4 12.6h4.4')}`,
    check: P('M4.6 10.4 8.2 14l7.2-8'),
    file: `${P('M5 2.9h6.2L15 6.7v10.4H5z')}${P('M11 2.9v4h4')}`,
    info: `<circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.4"/>${P('M10 9v4.4')}<circle cx="10" cy="6.5" r=".9" fill="currentColor"/>`,
    zoomFit: `${P('M4 7.6V4h3.6M16 12.4V16h-3.6M4 12.4V16h3.6M16 7.6V4h-3.6')}`,
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
