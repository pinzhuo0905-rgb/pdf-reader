/* 界面交互：工具栏、菜单、搜索、保存、打印、设置 */
(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const S = () => App.state;
  const $ = (id) => document.getElementById(id);
  const t = (k, v) => window.App.i18n.t(k, v);

  const ui = {
    searchTimer: 0,
    zoomDragging: false,
  };

  /* ============================== 初始化 ============================== */
  function init() {
    Icons.hydrate();
    initWindowControls();
    initToolbarScroll();

    // 工具栏：左上角汉堡按钮展开「目录」侧栏
    $('btn-menu').onclick = () => toggleSidebar();
    $('btn-undo').onclick = () => App.history.undo();
    $('btn-redo').onclick = () => App.history.redo();
    $('btn-highlight').onclick = () => setTool(S().tool === 'highlight' ? 'select' : 'highlight');
    $('btn-hl-caret').onclick = (e) => openHighlightMenu(e.currentTarget);
    $('btn-draw').onclick = () => setTool(S().tool === 'draw' ? 'select' : 'draw');
    $('btn-draw-caret').onclick = (e) => openPenMenu(e.currentTarget);
    $('btn-eraser').onclick = () => setTool(S().tool === 'eraser' ? 'select' : 'eraser');
    $('btn-eraser-caret').onclick = (e) => openEraserMenu(e.currentTarget);
    $('btn-textbox').onclick = () => setTool(S().tool === 'textbox' ? 'select' : 'textbox');
    $('btn-ocr').onclick = () => App.ocr.toggle();
    $('btn-more').onclick = (e) => openMoreMenu(e.currentTarget);

    // 中部
    $('btn-zoom-out').onclick = () => App.viewer.zoomOut();
    $('btn-zoom-in').onclick = () => App.viewer.zoomIn();
    $('btn-fit-width').onclick = () => App.viewer.fitWidth();
    $('btn-rotate').onclick = () => App.viewer.rotatePage(S().currentPage, 90);
    $('btn-viewmode').onclick = toggleTwoUp;

    // 缩放滑块：拖动时实时缩放（平滑，按百分比）
    const range = $('zoom-range');
    if (range) {
      const begin = () => {
        ui.zoomDragging = true;
      };
      const end = () => {
        ui.zoomDragging = false;
      };
      range.addEventListener('pointerdown', begin);
      range.addEventListener('pointerup', end);
      range.addEventListener('pointercancel', end);
      range.addEventListener('blur', end);
      range.addEventListener('input', () => {
        ui.zoomDragging = true;
        App.viewer.zoomTo(Number(range.value) / 100);
      });
      range.addEventListener('change', end);
      range.addEventListener('keydown', (e) => e.stopPropagation());
    }
    updateZoom(1);
    $('page-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const n = parseInt($('page-input').value, 10);
        if (!isNaN(n)) App.viewer.scrollToPage(Math.max(0, Math.min(S().pages.length - 1, n - 1)));
        e.currentTarget.blur();
      }
    });
    $('page-input').addEventListener('focus', (e) => e.target.select());

    // 右侧
    $('btn-search').onclick = toggleSearch;
    $('btn-print').onclick = doPrint;
    $('btn-save').onclick = () => save(false);
    $('btn-saveas').onclick = () => save(true);
    $('btn-fullscreen').onclick = toggleFullscreen;
    $('btn-settings').onclick = (e) => openSettingsMenu(e.currentTarget);
    $('btn-editpdf').onclick = () => setEditMode(!S().editMode);

    // 编辑工具条
    $('eb-select').onclick = () => setTool('select');
    $('eb-textedit').onclick = () => setTool('textedit');
    $('eb-textbox').onclick = () => setTool('textbox');
    $('eb-image').onclick = () => setTool('image');
    $('eb-shape').onclick = (e) => openShapeMenu(e.currentTarget);
    $('eb-whiteout').onclick = () => setTool('whiteout');
    $('eb-rotate').onclick = () => App.viewer.rotatePage(S().currentPage, 90);
    $('eb-deletepage').onclick = () => App.viewer.deletePage(S().currentPage);
    $('eb-insertpage').onclick = () => App.viewer.insertBlankPage(S().currentPage);
    $('eb-done').onclick = () => setEditMode(false);

    // 搜索条
    $('search-input').addEventListener('input', onSearchInput);
    $('search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navSearch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        closeSearch();
      }
    });
    $('search-next').onclick = () => navSearch(1);
    $('search-prev').onclick = () => navSearch(-1);
    $('search-close').onclick = closeSearch;

    // 侧栏
    $('sidebar-close').onclick = () => App.viewer.toggleSidebar(false);

    // 空状态
    $('empty-open').onclick = openFileDialog;

    // 弹窗
    $('modal-close').onclick = closeModal;

    // 菜单层点击关闭
    $('menuLayer').addEventListener('pointerdown', (e) => {
      if (e.target === $('menuLayer')) closeMenus();
    });
    document.addEventListener('pointerdown', (e) => {
      const ctx = $('ctxMenu');
      if (!ctx.classList.contains('hidden') && !ctx.contains(e.target)) hideCtxMenu();
    });

    // 键盘
    window.addEventListener('keydown', onKeyDown);

    // 拖放
    setupDragDrop();

    // 关闭确认
    window.api.onCloseRequest(() => confirmClose());

    applyTheme('light');
    // 标注交互绑在标签页容器上（事件委托），每个标签页的页面都在其中
    App.annotate.attachInteractions($('views'));
    setTool('select');
    setDocState(false);
  }

  const DOC_BUTTONS = [
    'page-input',
    'btn-zoom-in',
    'btn-zoom-out',
    'zoom-range',
    'btn-fit-width',
    'btn-rotate',
    'btn-viewmode',
    'btn-search',
    'btn-print',
    'btn-save',
    'btn-saveas',
    'btn-highlight',
    'btn-hl-caret',
    'btn-draw',
    'btn-draw-caret',
    'btn-eraser',
    'btn-textbox',
    'btn-ocr',
    'btn-more',
    'btn-editpdf',
  ];

  /* ============================ 工具栏横向滚动 ============================ */

  /**
   * 窗口变窄时整条工具栏横向滚动。
   *
   * 之前是靠断点隐藏按钮腾地方（先藏滑块、再藏打印/另存为），但窗口小到一定程度
   * 「更多工具」和缩放组还是会压在一起。现在功能键全保留，溢出部分靠两端箭头
   * 或触控板横滑访问；箭头只在对应方向还能滚时才出现，滚到头自动让位。
   */
  function initToolbarScroll() {
    const bar = $('toolbar');
    const box = $('tb-scroll');
    const prev = $('tb-prev');
    const next = $('tb-next');
    if (!bar || !box || !prev || !next) return;

    const sync = () => {
      const max = box.scrollWidth - box.clientWidth;
      bar.classList.toggle('can-prev', box.scrollLeft > 1);
      bar.classList.toggle('can-next', max > 1 && box.scrollLeft < max - 1);
    };

    const step = (dir) => {
      // 一次滚过半屏：既能看到新内容，也不会因为步长太大而失去位置感
      const span = Math.max(160, Math.round(box.clientWidth * 0.6));
      const max = box.scrollWidth - box.clientWidth;
      const from = box.scrollLeft;
      const target = Math.max(0, Math.min(max, from + dir * span));
      if (Math.abs(target - from) < 1) return;
      box.scrollTo({ left: target, behavior: 'smooth' });
      // 平滑滚动在窗口被遮挡 / 渲染被节流时不会推进，这时直接落位，别让按钮像失灵
      clearTimeout(step.timer);
      step.timer = setTimeout(() => {
        if (Math.abs(box.scrollLeft - from) < 1) box.scrollLeft = target;
      }, 260);
    };

    prev.onclick = () => step(-1);
    next.onclick = () => step(1);
    box.addEventListener('scroll', sync, { passive: true });

    // 鼠标滚轮竖着滚也能带动工具栏横移；触控板横向滑动由浏览器原生处理
    box.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
        if (box.scrollWidth <= box.clientWidth + 1) return;
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        box.scrollLeft += delta;
        e.preventDefault();
      },
      { passive: false }
    );

    // 窗口缩放、语言切换（按钮文字变宽）都要重算箭头显隐
    if (typeof ResizeObserver === 'function') new ResizeObserver(sync).observe(box);
    window.addEventListener('resize', sync);
    sync();
  }

  /* ============================ 自绘窗口按钮 ============================ */

  function initWindowControls() {
    const min = $('win-min');
    const max = $('win-max');
    const close = $('win-close');
    if (!min || !max || !close) return;

    min.onclick = () => window.api.minimizeWindow();
    max.onclick = () => window.api.toggleMaximize();
    close.onclick = () => window.api.closeWindow();

    window.api.onMaximized((v) => setMaxIcon(v));
    window.api
      .isMaximized()
      .then(setMaxIcon)
      .catch(() => {});
  }

  /** 最大化时把按钮图标换成「还原」 */
  function setMaxIcon(max) {
    const btn = $('win-max');
    if (!btn) return;
    btn.innerHTML = Icons.svg(max ? 'winRestore' : 'winMax');
    btn.title = t(max ? 'win.restore' : 'win.max');
  }

  /** 左上角汉堡：展开/收起「目录」侧栏 */
  function toggleSidebar() {
    if (!S().pdfDoc) {
      toast(t('toast.openFirst'));
      return;
    }
    const open = App.viewer.toggleSidebar();
    $('btn-menu').classList.toggle('active', open);
  }

  /** 切换标签页时，把该标签页的状态同步到界面 */
  function syncTabUI(t) {
    const st = t.state;
    setDocState(!!st.pdfDoc);
    $('main').dataset.tool = st.tool;

    Object.entries(TOOL_BUTTONS).forEach(([k, id]) => $(id).classList.toggle('active', k === st.tool));
    $('grp-highlight').classList.toggle('active', st.tool === 'highlight');
    $('grp-draw').classList.toggle('active', st.tool === 'draw');
    $('grp-eraser').classList.toggle('active', st.tool === 'eraser');

    const map = {
      select: 'eb-select',
      textedit: 'eb-textedit',
      textbox: 'eb-textbox',
      image: 'eb-image',
      shape: 'eb-shape',
      whiteout: 'eb-whiteout',
    };
    Object.entries(map).forEach(([k, id]) => $(id).classList.toggle('active', k === st.tool));

    $('editbar').classList.toggle('hidden', !st.editMode);
    $('btn-editpdf').classList.toggle('primary', !!st.editMode);
    $('btn-viewmode').classList.toggle('active', !!st.twoUp);
    updateZoom(st.zoom || 1);
    $('hl-swatch').style.background = st.opts.highlightColor;
    renderToolProps();
    App.history.updateUndoButtons();

    $('empty').classList.toggle('hidden', !!st.pdfDoc);
    if (!st.pdfDoc) {
      $('page-input').value = '';
      $('page-total').textContent = '/ 0';
    }

    // 搜索条随标签页走
    if (st.search && st.search.query) {
      $('searchbar').classList.remove('hidden');
      $('search-input').value = st.search.query;
      $('search-count').textContent = st.search.matches.length
        ? `${st.search.index + 1}/${st.search.matches.length}`
        : '0/0';
    } else {
      $('searchbar').classList.add('hidden');
      $('search-input').value = '';
      $('search-count').textContent = '0/0';
    }

    // OCR 面板显示当前标签页的结果
    App.ocr.renderList();

    // 侧栏是全局唯一的：切换标签页后必须重画缩略图与书签，否则会停留在上一个文档
    if (App.viewer.isSidebarOpen()) {
      App.viewer.buildThumbs();
      App.viewer.buildOutline();
    }

    setTitle();
  }

  /** 没有打开文档时禁用依赖文档的按钮 */
  function setDocState(hasDoc) {
    for (const id of DOC_BUTTONS) {
      const el = $(id);
      if (el) el.disabled = !hasDoc;
    }
    if (!hasDoc) {
      $('page-input').value = '';
      $('page-total').textContent = '/ 0';
    }
  }

  /* ============================== 工具切换 ============================== */
  const TOOL_BUTTONS = {
    highlight: 'btn-highlight',
    draw: 'btn-draw',
    eraser: 'btn-eraser',
    textbox: 'btn-textbox',
  };
  const EDIT_TOOLS = ['select', 'textedit', 'textbox', 'image', 'shape', 'whiteout'];

  function setTool(tool) {
    const state = S();
    state.tool = tool;
    state.selected = null;
    if (App.annotate.hideEraserCursor) App.annotate.hideEraserCursor();
    $('main').dataset.tool = tool;

    Object.entries(TOOL_BUTTONS).forEach(([t, id]) => {
      $(id).classList.toggle('active', t === tool);
    });
    $('grp-highlight').classList.toggle('active', tool === 'highlight');
    $('grp-draw').classList.toggle('active', tool === 'draw');
    $('grp-eraser').classList.toggle('active', tool === 'eraser');

    // 编辑条按钮
    const map = {
      select: 'eb-select',
      textedit: 'eb-textedit',
      textbox: 'eb-textbox',
      image: 'eb-image',
      shape: 'eb-shape',
      whiteout: 'eb-whiteout',
    };
    Object.entries(map).forEach(([t, id]) => {
      $(id).classList.toggle('active', t === tool);
    });

    if (EDIT_TOOLS.includes(tool) && tool !== 'select' && !state.editMode) setEditMode(true, true);
    if (!EDIT_TOOLS.includes(tool) && state.editMode && ['highlight', 'draw', 'eraser'].includes(tool)) {
      setEditMode(false, true);
    }
    App.viewer.refreshOverlays();
    renderToolProps();
  }

  function setEditMode(on, silent) {
    const state = S();
    state.editMode = on;
    $('editbar').classList.toggle('hidden', !on);
    $('btn-editpdf').classList.toggle('primary', on);
    if (on) {
      if (!EDIT_TOOLS.includes(state.tool)) setTool('textedit');
      else renderToolProps();
      if (!silent) toast(t('toast.editModeOn'));
    } else {
      // 退出编辑模式：编辑类工具回到选择工具，标注类工具保持不变
      const keep = ['select', 'highlight', 'draw', 'eraser'];
      const next = keep.includes(state.tool) ? state.tool : 'select';
      setToolSilently(next);
      renderToolProps();
    }
    App.viewer.onResize();
  }

  function setToolSilently(tool) {
    S().tool = tool;
    $('main').dataset.tool = tool;
    Object.entries(TOOL_BUTTONS).forEach(([t, id]) => $(id).classList.toggle('active', t === tool));
    $('grp-highlight').classList.remove('active');
    $('grp-draw').classList.remove('active');
    $('grp-eraser').classList.remove('active');
    ['eb-select', 'eb-textedit', 'eb-textbox', 'eb-image', 'eb-shape', 'eb-whiteout'].forEach((id) =>
      $(id).classList.remove('active')
    );
  }

  /* ============================== 工具属性 ============================== */
  function renderToolProps() {
    const box = $('eb-props');
    const state = S();
    box.innerHTML = '';
    const tool = state.tool;

    const swatches = (colors, key) => {
      colors.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sw' + (state.opts[key] === c ? ' on' : '');
        b.style.background = c;
        b.title = c;
        b.onclick = () => {
          state.opts[key] = c;
          if (key === 'highlightColor') $('hl-swatch').style.background = c;
          renderToolProps();
        };
        box.appendChild(b);
      });
    };

    const range = (label, key, min, max, step, suffix = '') => {
      const l = document.createElement('label');
      l.textContent = label;
      const r = document.createElement('input');
      r.type = 'range';
      r.min = min;
      r.max = max;
      r.step = step;
      r.value = state.opts[key];
      const val = document.createElement('span');
      val.textContent = state.opts[key] + suffix;
      val.style.minWidth = '30px';
      r.oninput = () => {
        state.opts[key] = Number(r.value);
        val.textContent = r.value + suffix;
      };
      l.appendChild(r);
      l.appendChild(val);
      box.appendChild(l);
    };

    if (tool === 'textedit' || tool === 'textbox') {
      swatches(App.COLORS.text, 'textColor');
      range(t('prop.fontSize'), 'fontSize', 8, 48, 1);
    } else if (tool === 'shape') {
      swatches(App.COLORS.shape, 'shapeColor');
      range(t('prop.lineWidth'), 'shapeWidth', 1, 10, 0.5);
    } else if (tool === 'highlight') {
      swatches(App.COLORS.highlight, 'highlightColor');
    } else if (tool === 'draw') {
      swatches(App.COLORS.pen, 'penColor');
      range(t('prop.width'), 'penWidth', 1, 14, 0.5);
    } else if (tool === 'whiteout') {
      const tip = document.createElement('span');
      tip.style.cssText = 'font-size:12px;color:var(--text-dim)';
      tip.textContent = t('prop.whiteoutTip');
      box.appendChild(tip);
    } else if (tool === 'select') {
      const tip = document.createElement('span');
      tip.style.cssText = 'font-size:12px;color:var(--text-dim)';
      tip.textContent = t('prop.selectTip');
      box.appendChild(tip);
    }
  }

  /* ============================== 菜单 ============================== */
  let menuCloseTimer = 0;

  /**
   * 关菜单。
   * 默认先播收回动画（0.16s）再真正隐藏——直接挂 .hidden 是 display:none，
   * 会把动画直接掐掉，看起来就是「展开有动画、收回没有」。
   * immediate=true 用于打开新菜单/窗口失焦等必须立刻换内容的场景。
   */
  function closeMenus(immediate) {
    const layer = $('menuLayer');
    const menu = layer.querySelector('.menu');
    clearTimeout(menuCloseTimer);
    if (immediate || !menu || layer.classList.contains('hidden')) {
      layer.classList.add('hidden');
      layer.classList.remove('closing');
      layer.innerHTML = '';
      return;
    }
    // 收回期间整层不接收点击，否则这 160ms 里点哪都被这层吃掉
    layer.classList.add('closing');
    menu.classList.add('menu-out');
    menuCloseTimer = setTimeout(() => {
      layer.classList.add('hidden');
      layer.classList.remove('closing');
      layer.innerHTML = '';
    }, 160);
  }

  function showMenu(anchor, html, opts = {}) {
    const layer = $('menuLayer');
    clearTimeout(menuCloseTimer);
    layer.classList.remove('closing');
    layer.classList.remove('hidden');
    layer.innerHTML = '';
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.innerHTML = html;
    layer.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    let left = opts.alignRight ? r.right - menu.offsetWidth : r.left;
    let top = r.bottom + 6;
    left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, left));
    if (top + menu.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, r.top - menu.offsetHeight - 6);
    }
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    return menu;
  }

  function menuItemHTML(label, icon, kbd) {
    return `<div class="menu-item">${icon ? Icons.svg(icon) : ''}<span>${label}</span>${
      kbd ? `<span class="kbd">${kbd}</span>` : ''
    }</div>`;
  }

  function bindMenuItems(menu, actions) {
    const items = menu.querySelectorAll('.menu-item');
    items.forEach((el, i) => {
      const a = actions[i];
      if (!a) return;
      el.onclick = () => {
        closeMenus();
        a();
      };
    });
  }

  function colorMenuHTML(title, colors, current) {
    return `<div class="menu-title">${title}</div><div class="color-grid">${colors
      .map((c) => `<button type="button" data-c="${c}" class="${c === current ? 'on' : ''}" style="background:${c}"></button>`)
      .join('')}</div>`;
  }

  function openHighlightMenu(anchor) {
    const menu = showMenu(anchor, colorMenuHTML(t('menu.hlColor'), App.COLORS.highlight, S().opts.highlightColor));
    menu.querySelectorAll('.color-grid button').forEach((b) => {
      b.onclick = () => {
        S().opts.highlightColor = b.dataset.c;
        $('hl-swatch').style.background = b.dataset.c;
        closeMenus();
        setTool('highlight');
        renderToolProps();
      };
    });
  }

  function openPenMenu(anchor) {
    const o = S().opts;
    const menu = showMenu(
      anchor,
      `${colorMenuHTML(t('menu.penColor'), App.COLORS.pen, o.penColor)}
       <div class="menu-title">${t('menu.penWidth')}</div>
       <div style="display:flex;align-items:center;gap:8px;padding:0 12px 10px">
         <input id="pen-range" type="range" min="1" max="14" step="0.5" value="${o.penWidth}" style="flex:1;accent-color:var(--accent)"/>
         <span id="pen-val" style="font-size:12px;min-width:22px;text-align:right">${o.penWidth}</span>
       </div>`
    );
    menu.querySelectorAll('.color-grid button').forEach((b) => {
      b.onclick = () => {
        o.penColor = b.dataset.c;
        menu.querySelectorAll('.color-grid button').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
    const r = menu.querySelector('#pen-range');
    const v = menu.querySelector('#pen-val');
    r.oninput = () => {
      o.penWidth = Number(r.value);
      v.textContent = r.value;
    };
    // 选完颜色直接切到绘制工具
    menu.addEventListener('click', (e) => {
      if (e.target.closest('.color-grid')) {
        closeMenus();
        setTool('draw');
      }
    });
  }

  /** 橡皮大小：和「绘制」一样用下拉菜单，改完直接切到橡皮 */
  function openEraserMenu(anchor) {
    const o = S().opts;
    const menu = showMenu(
      anchor,
      `<div class="menu-title">${t('menu.eraserSize')}</div>
       <div style="display:flex;align-items:center;gap:8px;padding:0 12px 8px">
         <input id="eraser-range" type="range" min="4" max="48" step="1" value="${o.eraserRadius}" style="flex:1;accent-color:var(--accent)"/>
         <span id="eraser-val" style="font-size:12px;min-width:38px;text-align:right">${o.eraserRadius}px</span>
       </div>
       <div style="padding:0 12px 10px;font-size:12px;color:var(--text-dim);line-height:1.5">
         ${t('menu.eraserTip')}
       </div>`
    );
    const r = menu.querySelector('#eraser-range');
    const v = menu.querySelector('#eraser-val');
    r.oninput = () => {
      o.eraserRadius = Number(r.value);
      v.textContent = r.value + 'px';
    };
    setTool('eraser');
  }

  function openMoreMenu(anchor) {
    const menu = showMenu(
      anchor,
      [
        menuItemHTML(t('menu.open'), 'file', 'Ctrl+O'),
        menuItemHTML(t('menu.newTab'), 'file', 'Ctrl+T'),
        '<div class="menu-sep"></div>',
        menuItemHTML(t('menu.image'), 'image'),
        menuItemHTML(t('menu.shape'), 'shapes'),
        menuItemHTML(t('menu.whiteout'), 'whiteout'),
        '<div class="menu-sep"></div>',
        menuItemHTML(t('menu.rotate'), 'rotate'),
        menuItemHTML(t('menu.insertPage'), 'file'),
        menuItemHTML(t('menu.deletePage'), 'close'),
        '<div class="menu-sep"></div>',
        menuItemHTML(t('menu.ocr'), 'ocr'),
        menuItemHTML(t('menu.editPdf'), 'editText'),
        '<div class="menu-sep"></div>',
        menuItemHTML(t('menu.props'), 'info'),
        menuItemHTML(t('menu.shortcuts'), 'menu'),
        menuItemHTML(t('menu.defaultApp'), 'file'),
        menuItemHTML(t('menu.about'), 'info'),
      ].join('')
    );
    bindMenuItems(menu, [
      openFileDialog,
      () => App.tabs.createBlank(true),
      () => setTool('image'),
      () => openShapeMenu(anchor),
      () => setTool('whiteout'),
      () => App.viewer.rotatePage(S().currentPage, 90),
      () => App.viewer.insertBlankPage(S().currentPage),
      () => App.viewer.deletePage(S().currentPage),
      () => {
        App.ocr.open();
        App.ocr.runPage();
      },
      () => setEditMode(true),
      showDocProps,
      showShortcuts,
      () => window.api.openDefaultApps(),
      showAbout,
    ]);
  }

  function openShapeMenu(anchor) {
    const o = S().opts;
    const kinds = [
      ['rect', t('menu.shapeRect')],
      ['ellipse', t('menu.shapeEllipse')],
      ['line', t('menu.shapeLine')],
      ['arrow', t('menu.shapeArrow')],
    ];
    const menu = showMenu(
      anchor,
      `${kinds
        .map(
          ([k, n]) =>
            `<div class="menu-item" data-k="${k}">${Icons.svg('shapes')}<span>${n}</span>${
              o.shapeKind === k ? '<span class="kbd">✓</span>' : ''
            }</div>`
        )
        .join('')}<div class="menu-sep"></div>
        ${colorMenuHTML(t('menu.lineColor'), App.COLORS.shape, o.shapeColor)}`
    );
    menu.querySelectorAll('.menu-item[data-k]').forEach((el) => {
      el.onclick = () => {
        o.shapeKind = el.dataset.k;
        closeMenus();
        setTool('shape');
      };
    });
    menu.querySelectorAll('.color-grid button').forEach((b) => {
      b.onclick = () => {
        o.shapeColor = b.dataset.c;
        menu.querySelectorAll('.color-grid button').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
  }

  function openSettingsMenu(anchor) {
    const s = S().settings;
    const lang = App.i18n.lang;
    const mark = (on) => `<span class="kbd">${on ? '✓' : ''}</span>`;
    const menu = showMenu(
      anchor,
      [
        `<div class="menu-title">${t('menu.theme')}</div>`,
        `<div class="menu-item" data-t="light"><span>${t('menu.light')}</span>${mark(s.theme === 'light')}</div>`,
        `<div class="menu-item" data-t="dark"><span>${t('menu.dark')}</span>${mark(s.theme === 'dark')}</div>`,
        `<div class="menu-item" data-t="system"><span>${t('menu.system')}</span>${mark(s.theme === 'system')}</div>`,
        '<div class="menu-sep"></div>',
        `<div class="menu-title">${t('menu.lang')}</div>`,
        `<div class="menu-item" data-l="zh"><span>${t('menu.langZh')}</span>${mark(lang === 'zh')}</div>`,
        `<div class="menu-item" data-l="en"><span>${t('menu.langEn')}</span>${mark(lang === 'en')}</div>`,
        '<div class="menu-sep"></div>',
        menuItemHTML(t('menu.shortcuts'), 'menu'),
        menuItemHTML(t('menu.about'), 'info'),
      ].join(''),
      { alignRight: true }
    );
    menu.querySelectorAll('.menu-item[data-t]').forEach((el) => {
      el.onclick = () => {
        const th = el.dataset.t;
        S().settings.theme = th;
        window.api.setSettings({ theme: th });
        applyTheme(th);
        closeMenus();
      };
    });
    menu.querySelectorAll('.menu-item[data-l]').forEach((el) => {
      el.onclick = () => {
        const next = el.dataset.l;
        S().settings.lang = next;
        window.api.setSettings({ lang: next });
        App.i18n.setLang(next);
        closeMenus();
      };
    });
    const items = menu.querySelectorAll('.menu-item:not([data-t]):not([data-l])');
    items[0].onclick = () => {
      closeMenus(true);
      showShortcuts();
    };
    items[1].onclick = () => {
      closeMenus(true);
      showAbout();
    };
  }

  /** 切换语言后重建所有带文案的动态 UI */
  function refreshTexts() {
    renderToolProps();
    updateZoom(S().zoom);
    $('btn-viewmode').classList.toggle('active', !!S().twoUp);
    $('hl-swatch').style.background = S().opts.highlightColor;
    if (S().pdfDoc) setTitle();
  }

  /* ============================== 主题 ============================== */
  function applyTheme(theme) {
    const app = $('app');
    const dark =
      theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    app.classList.toggle('theme-dark', dark);
    app.classList.toggle('theme-light', !dark);
  }

  /* ============================== 文件 ============================== */
  async function openFileDialog() {
    const p = await window.api.openDialog();
    if (p) openPath(p);
  }

  async function openPath(path, page) {
    return App.tabs.openPath(path, page);
  }

  /** 保存指定标签页（必要时先切过去） */
  async function saveTab(t) {
    if (!t) return false;
    if (App.tabs && App.tabs.active() !== t) {
      App.tabs.activate(t.id);
      await new Promise((r) => setTimeout(r, 80));
    }
    return save(false);
  }

  function setTitle() {
    if (App.tabs) {
      App.tabs.refreshActive();
      return;
    }
    const st = S();
    document.title = st.fileName ? `${st.fileName}${st.dirty ? ' *' : ''} - PDF Reader` : 'PDF Reader';
  }

  async function save(as) {
    const st = S();
    if (!st.bytes) {
      toast(t('toast.openPdfFirst'));
      return false;
    }
    // 用内容指纹判断：撤销回初始状态后按 Ctrl+S 也要能把文件改回去，
    // 所以不能再用「有没有标注」作为门槛
    const snap = App.history.snapshot();
    if (!as && st.savedFingerprint === snap) {
      toast(t('toast.noChanges'));
      return true;
    }
    App.viewer.showLoading(t('toast.saving'));
    try {
      const bytes = await App.exporter.build();
      let target = st.filePath;
      if (as || !target) {
        const res = await window.api.saveAs(st.fileName || t('file.untitled'), bytes);
        if (!res.ok) {
          App.viewer.hideLoading();
          return false;
        }
        target = res.path;
      } else {
        await window.api.save(target, bytes);
      }
      // 关键：保存后不重新加载文档。
      // state.bytes 始终是「打开时的原始字节」，每次保存都由「原始 + 当前标注」重新生成，
      // 因此：视图不会跳回第一页、撤销栈不会丢、重复保存也不会把标注写两遍。
      const name = target.split(/[\\/]/).pop();
      st.filePath = target;
      st.fileName = name;
      st.dirty = false;
      st.savedFingerprint = snap;
      App.viewer.hideLoading();
      setTitle();
      App.history.updateUndoButtons();
      toast(t('toast.saved', { name }));
      return true;
    } catch (e) {
      console.error(e);
      App.viewer.hideLoading();
      toast(t('toast.saveFailed', { msg: e.message }));
      return false;
    }
  }

  /* ============================== 打印 ============================== */
  async function doPrint() {
    const st = S();
    if (!st.pdfDoc) return;
    App.viewer.showLoading(t('toast.printPrepare'));
    try {
      const pages = [];
      const dpr = 2;
      for (let i = 0; i < st.pages.length; i++) {
        const p = st.pages[i];
        const w = Math.round(p.wPt * dpr);
        const h = Math.round(p.hPt * dpr);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        if (p.src != null) {
          const page = await st.pdfDoc.getPage(p.src + 1);
          const vp = page.getViewport({ scale: dpr, rotation: p.rot });
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
        }
        for (const a of App.annots.get(p.id)) App.annotate.paint(ctx, a, w, h, dpr, true);
        pages.push({
          dataUrl: canvas.toDataURL('image/png'),
          width: Math.round((p.wPt * 4) / 3),
          height: Math.round((p.hPt * 4) / 3),
        });
      }
      const first = st.pages[0];
      App.viewer.hideLoading();
      const res = await window.api.printPages({
        pages,
        pageSize: { width: Math.round((first.wPt * 4) / 3), height: Math.round((first.hPt * 4) / 3) },
      });
      if (!res.success && res.reason && res.reason !== 'cancelled') toast(t('toast.printIncomplete', { msg: res.reason }));
    } catch (e) {
      console.error(e);
      App.viewer.hideLoading();
      toast(t('toast.printFailed', { msg: e.message }));
    }
  }

  /* ============================== 搜索 ============================== */
  function toggleSearch() {
    const bar = $('searchbar');
    if (bar.classList.contains('hidden')) {
      bar.classList.remove('hidden');
      $('search-input').focus();
      $('search-input').select();
    } else {
      closeSearch();
    }
  }

  function closeSearch() {
    $('searchbar').classList.add('hidden');
    S().search = { query: '', matches: [], index: -1 };
    App.viewer.refreshOverlays();
  }

  function onSearchInput() {
    clearTimeout(ui.searchTimer);
    const q = $('search-input').value.trim();
    ui.searchTimer = setTimeout(async () => {
      const res = await App.viewer.search(q);
      $('search-count').textContent = res.matches.length ? `1/${res.matches.length}` : '0/0';
    }, 220);
  }

  function navSearch(dir) {
    const s = S().search;
    if (!s.matches.length) return;
    const i = App.viewer.gotoSearcMatch(s.index + dir);
    $('search-count').textContent = `${i + 1}/${s.matches.length}`;
  }

  /* ============================== 视图 ============================== */
  /** 同步缩放滑块（拖动中不要抢用户的值） */
  function updateZoom(zoom, preview) {
    const r = $('zoom-range');
    if (!r) return;
    const pct = Math.max(15, Math.min(500, Math.round(zoom * 100)));
    if (!ui.zoomDragging || preview) r.value = String(pct);
    r.title = t('tb.zoomLevel') + ' ' + pct + '%';
  }

  function toggleTwoUp() {
    const st = S();
    if (!st.pdfDoc) {
      toast(t('toast.openFirst'));
      return;
    }
    const on = App.viewer.setTwoUp(!st.twoUp);
    $('btn-viewmode').classList.toggle('active', !!on);
    updateZoom(S().zoom);
    toast(t(on ? 'toast.twoUpOn' : 'toast.twoUpOff'));
  }

  async function toggleFullscreen() {
    const v = await window.api.toggleFullscreen();
    $('btn-fullscreen').classList.toggle('active', v);
  }

  /* ============================ 文本选择/复制 ============================ */
  function selectedText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    return String(sel.toString() || '');
  }

  function copySelection() {
    const text = selectedText();
    if (!text.trim()) {
      toast(t('toast.selectFirst'));
      return false;
    }
    const done = () => toast(t('toast.copied', { n: text.length }));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        try {
          document.execCommand('copy');
          done();
        } catch (e) {
          toast(t('toast.copyFailed'));
        }
      });
    } else {
      try {
        document.execCommand('copy');
        done();
      } catch (e) {
        toast(t('toast.copyFailed'));
      }
    }
    return true;
  }

  function selectAllText() {
    const pages = document.querySelectorAll('#views .view.active .page .textLayer');
    if (!pages.length) return;
    const range = document.createRange();
    range.setStart(pages[0], 0);
    const last = pages[pages.length - 1];
    range.setEnd(last, last.childNodes.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast(t('toast.selectAll'));
  }

  /* ============================== 弹窗 ============================== */
  function showModal(title, bodyHTML, footButtons = [{ label: t('modal.close'), primary: true }]) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHTML;
    const foot = $('modal-foot');
    foot.innerHTML = '';
    for (const b of footButtons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = b.primary ? 'btn-primary' : 'btn-ghost';
      btn.textContent = b.label;
      btn.onclick = () => {
        closeModal();
        if (b.onClick) b.onClick();
      };
      foot.appendChild(btn);
    }
    $('modal').classList.remove('hidden');
  }

  function closeModal() {
    $('modal').classList.add('hidden');
  }

  async function showDocProps() {
    const st = S();
    if (!st.pdfDoc) {
      toast(t('toast.openFirst'));
      return;
    }
    let meta = {};
    try {
      const m = await st.pdfDoc.getMetadata();
      meta = m.info || {};
    } catch {
      /* 忽略 */
    }
    const size = st.bytes ? (st.bytes.length / 1024).toFixed(1) + ' KB' : '-';
    const fmt = (d) => (d ? new Date(d).toLocaleString() : '-');
    showModal(
      t('props.title'),
      `<table>
        <tr><td>${t('props.fileName')}</td><td>${escapeHtml(st.fileName || '-')}</td></tr>
        <tr><td>${t('props.pages')}</td><td>${st.pages.length}</td></tr>
        <tr><td>${t('props.size')}</td><td>${size}</td></tr>
        <tr><td>${t('props.docTitle')}</td><td>${escapeHtml(meta.Title || '-')}</td></tr>
        <tr><td>${t('props.author')}</td><td>${escapeHtml(meta.Author || '-')}</td></tr>
        <tr><td>${t('props.created')}</td><td>${fmt(meta.CreationDate)}</td></tr>
        <tr><td>${t('props.modified')}</td><td>${fmt(meta.ModDate)}</td></tr>
      </table>`
    );
  }

  function showShortcuts() {
    const rows = [
      ['Ctrl + O', t('sc.open')],
      ['Ctrl + S', t('sc.save')],
      ['Ctrl + Shift + S', t('sc.saveAs')],
      ['Ctrl + P', t('sc.print')],
      ['Ctrl + F', t('sc.search')],
      ['Ctrl + Z / Ctrl + Y', t('sc.undoRedo')],
      ['Ctrl + + / Ctrl + -', t('sc.zoom')],
      [t('sc.zoomWheelKey'), t('sc.zoomWheel')],
      ['Ctrl + 0', t('sc.fitPage')],
      ['PageUp / PageDown', t('sc.pageNav')],
      ['H / D / E / T', t('sc.tools')],
      ['Delete', t('sc.delete')],
      ['Esc', t('sc.esc')],
    ];
    showModal(
      t('sc.title'),
      `<table>${rows.map(([k, v]) => `<tr><td style="width:180px">${k}</td><td>${v}</td></tr>`).join('')}</table>`
    );
  }

  async function showAbout() {
    const v = await window.api.appVersion();
    showModal(
      t('about.title'),
      `<div style="display:flex;gap:14px;align-items:center;margin-bottom:10px">
        <img src="assets/pdf-icon-256.png" alt="" style="width:56px;height:56px"/>
        <div><div style="font-size:15px;font-weight:600">PDF Reader</div>
        <div style="color:var(--text-dim);font-size:12px">${t('about.version')} ${v.app}</div></div>
      </div>
      <div style="color:var(--text-dim);font-size:12.5px;line-height:1.7">
        ${t('about.desc')}<br/>
        Electron ${v.electron} · Chromium ${v.chrome}
      </div>`
    );
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ============================== 右键菜单 ============================== */
  let ctxCloseTimer = 0;

  /** 右键菜单同样先播收回动画再隐藏 */
  function hideCtxMenu(immediate) {
    const menu = $('ctxMenu');
    clearTimeout(ctxCloseTimer);
    if (immediate || menu.classList.contains('hidden')) {
      menu.classList.add('hidden');
      menu.classList.remove('menu-out');
      return;
    }
    menu.classList.add('menu-out');
    ctxCloseTimer = setTimeout(() => {
      menu.classList.add('hidden');
      menu.classList.remove('menu-out');
    }, 150);
  }

  function showCtxMenu(x, y, items) {
    const menu = $('ctxMenu');
    clearTimeout(ctxCloseTimer);
    menu.classList.remove('menu-out');
    menu.innerHTML = items
      .map((it) => `<div class="menu-item">${it.icon ? Icons.svg(it.icon) : ''}<span>${it.label}</span></div>`)
      .join('');
    menu.classList.remove('hidden');
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
    menu.querySelectorAll('.menu-item').forEach((el, i) => {
      el.onclick = () => {
        hideCtxMenu();
        items[i].onClick();
      };
    });
  }

  /* ============================== Toast ============================== */
  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  /* ============================== 键盘 ============================== */
  function onKeyDown(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const st = S();
    const active = document.activeElement;
    const typing = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

    if (ctrl && key.toLowerCase() === 'o') {
      e.preventDefault();
      openFileDialog();
    } else if (ctrl && key.toLowerCase() === 't') {
      e.preventDefault();
      App.tabs.createBlank(true);
    } else if (ctrl && key.toLowerCase() === 'w') {
      e.preventDefault();
      if (App.tabs.active()) App.tabs.close(App.tabs.active().id);
    } else if (ctrl && key === 'Tab') {
      e.preventDefault();
      App.tabs.next(e.shiftKey ? -1 : 1);
    } else if (ctrl && key.toLowerCase() === 's') {
      e.preventDefault();
      save(e.shiftKey);
    } else if (ctrl && key.toLowerCase() === 'p') {
      e.preventDefault();
      doPrint();
    } else if (ctrl && key.toLowerCase() === 'f') {
      e.preventDefault();
      toggleSearch();
    } else if (ctrl && key.toLowerCase() === 'z') {
      e.preventDefault();
      App.history.undo();
    } else if (ctrl && (key.toLowerCase() === 'y' || (e.shiftKey && key.toLowerCase() === 'z'))) {
      e.preventDefault();
      App.history.redo();
    } else if (ctrl && (key === '=' || key === '+')) {
      e.preventDefault();
      App.viewer.zoomIn();
    } else if (ctrl && key === '-') {
      e.preventDefault();
      App.viewer.zoomOut();
    } else if (ctrl && (key === 'ArrowUp' || key === 'ArrowDown')) {
      // Ctrl + ↑/↓：平滑缩放（和 Ctrl + 滚轮一致）
      e.preventDefault();
      if (key === 'ArrowUp') App.viewer.zoomIn();
      else App.viewer.zoomOut();
    } else if (ctrl && key.toLowerCase() === 'c') {
      if (selectedText().trim()) {
        e.preventDefault();
        copySelection();
      }
    } else if (ctrl && key.toLowerCase() === 'a') {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        selectAllText();
      }
    } else if (ctrl && key === '0') {
      e.preventDefault();
      App.viewer.fitPage();
    } else if (key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
    } else if (key === 'Escape') {
      if (!$('ocrPanel').classList.contains('hidden')) App.ocr.close();
      else if (!$('searchbar').classList.contains('hidden')) closeSearch();
      else if (st.tool !== 'select') setTool('select');
    } else if (!typing && (key === 'Delete' || key === 'Backspace')) {
      const sel = st.selected;
      if (sel) {
        const a = App.annots.find(sel.pageId, sel.annotId);
        if (a) {
          App.annots.remove(sel.pageId, sel.annotId);
          st.selected = null;
          toast(t('toast.annotDeleted'));
        }
        e.preventDefault();
      }
    } else if (!typing && key === 'PageDown') {
      App.viewer.scrollToPage(Math.min(st.pages.length - 1, st.currentPage + 1));
      e.preventDefault();
    } else if (!typing && key === 'PageUp') {
      App.viewer.scrollToPage(Math.max(0, st.currentPage - 1));
      e.preventDefault();
    } else if (!ctrl && !e.altKey) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = key.toLowerCase();
      if (k === 'h') setTool('highlight');
      else if (k === 'd') setTool('draw');
      else if (k === 'e') setTool('eraser');
      else if (k === 't') setTool('textbox');
      else if (k === 'r') App.viewer.rotatePage(st.currentPage, 90);
      else if (k === 'v') setTool('select');
    }
  }

  /* ============================== 拖放 ============================== */
  function setupDragDrop() {
    const empty = $('empty');
    const main = $('main');
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('dragover', (e) => {
      stop(e);
      empty.classList.add('dragover');
    });
    window.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null) empty.classList.remove('dragover');
    });
    window.addEventListener('drop', async (e) => {
      stop(e);
      empty.classList.remove('dragover');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      if (!/\.pdf$/i.test(file.name)) {
        toast(t('toast.pdfOnly'));
        return;
      }
      const p = window.api.pathForFile(file);
      if (p) {
        openPath(p);
      } else {
        const buf = new Uint8Array(await file.arrayBuffer());
        App.tabs.openBytes(buf, file.name);
      }
    });
  }

  /* ============================== 关闭确认 ============================== */
  function confirmClose() {
    const all = App.tabs ? App.tabs.list : [];
    const dirty = all.filter((t) => t.state.dirty);
    if (!dirty.length) {
      window.api.allowClose();
      return;
    }
    if (dirty.length === 1) {
      // 脏标签页不在前台时先切过去，否则「保存」会存错文档
      if (App.tabs.active() !== dirty[0]) App.tabs.activate(dirty[0].id);
      showModal(t('close.title'), t('close.desc'), [
        { label: t('modal.cancel') },
        { label: t('modal.dontSave'), onClick: () => window.api.allowClose() },
        {
          label: t('modal.save'),
          primary: true,
          onClick: async () => {
            const ok = await save(false);
            if (ok) window.api.allowClose();
          },
        },
      ]);
      return;
    }
    showModal(
      t('close.multiTitle'),
      `${t('close.multiDesc', { n: dirty.length })}<br/><span style="color:var(--text-dim)">${dirty
        .map((tb) => escapeHtml(tb.state.fileName || t('tab.untitled')))
        .join('、')}</span>`,
      [
        { label: t('modal.cancel') },
        { label: t('modal.dontSaveClose'), onClick: () => window.api.allowClose() },
      ]
    );
  }

  App.ui = {
    init,
    setTool,
    setEditMode,
    toast,
    showCtxMenu,
    setTitle,
    save,
    applyTheme,
    setDocState,
    syncTabUI,
    saveTab,
    toggleSidebar,
    copySelection,
    selectAllText,
    showModal,
    updateZoom,
    refreshTexts,
  };
})();
