/* 界面交互：工具栏、菜单、搜索、保存、打印、设置 */
(function () {
  const App = (window.App = window.App || {});
  const S = () => App.state;
  const $ = (id) => document.getElementById(id);

  const ui = {
    searchTimer: 0,
  };

  /* ============================== 初始化 ============================== */
  function init() {
    Icons.hydrate();
    initWindowControls();

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
      if (!ctx.classList.contains('hidden') && !ctx.contains(e.target)) ctx.classList.add('hidden');
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
    btn.title = max ? '向下还原' : '最大化';
  }

  /** 左上角汉堡：展开/收起「目录」侧栏 */
  function toggleSidebar() {
    if (!S().pdfDoc) {
      toast('请先打开 PDF 文件');
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

  /** 没有打开文档时禁用依赖文档的按钮（与 Edge 一致） */
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
      if (!silent) toast('编辑模式：点击文字可直接修改，或添加文本、图片、形状');
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
      range('字号', 'fontSize', 8, 48, 1);
    } else if (tool === 'shape') {
      swatches(App.COLORS.shape, 'shapeColor');
      range('线宽', 'shapeWidth', 1, 10, 0.5);
    } else if (tool === 'highlight') {
      swatches(App.COLORS.highlight, 'highlightColor');
    } else if (tool === 'draw') {
      swatches(App.COLORS.pen, 'penColor');
      range('粗细', 'penWidth', 1, 14, 0.5);
    } else if (tool === 'whiteout') {
      const tip = document.createElement('span');
      tip.style.cssText = 'font-size:12px;color:var(--text-dim)';
      tip.textContent = '拖动框选要遮盖的区域';
      box.appendChild(tip);
    } else if (tool === 'select') {
      const tip = document.createElement('span');
      tip.style.cssText = 'font-size:12px;color:var(--text-dim)';
      tip.textContent = '点击选中标注，拖动移动，Delete 删除';
      box.appendChild(tip);
    }
  }

  /* ============================== 菜单 ============================== */
  function closeMenus() {
    $('menuLayer').classList.add('hidden');
    $('menuLayer').innerHTML = '';
  }

  function showMenu(anchor, html, opts = {}) {
    const layer = $('menuLayer');
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
      .map((c) => `<button data-c="${c}" class="${c === current ? 'on' : ''}" style="background:${c}"></button>`)
      .join('')}</div>`;
  }

  function openHighlightMenu(anchor) {
    const menu = showMenu(anchor, colorMenuHTML('高亮颜色', App.COLORS.highlight, S().opts.highlightColor));
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
      `${colorMenuHTML('画笔颜色', App.COLORS.pen, o.penColor)}
       <div class="menu-title">粗细</div>
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
      `<div class="menu-title">橡皮大小</div>
       <div style="display:flex;align-items:center;gap:8px;padding:0 12px 8px">
         <input id="eraser-range" type="range" min="4" max="48" step="1" value="${o.eraserRadius}" style="flex:1;accent-color:var(--accent)"/>
         <span id="eraser-val" style="font-size:12px;min-width:38px;text-align:right">${o.eraserRadius}px</span>
       </div>
       <div style="padding:0 12px 10px;font-size:12px;color:var(--text-dim);line-height:1.5">
         按住拖动，擦掉圆点下方的涂鸦
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
        menuItemHTML('打开文件…', 'file', 'Ctrl+O'),
        menuItemHTML('新建标签页', 'file', 'Ctrl+T'),
        '<div class="menu-sep"></div>',
        menuItemHTML('插入图片', 'image'),
        menuItemHTML('插入形状', 'shapes'),
        menuItemHTML('涂改遮盖', 'whiteout'),
        '<div class="menu-sep"></div>',
        menuItemHTML('旋转页面', 'rotate'),
        menuItemHTML('插入空白页', 'file'),
        menuItemHTML('删除当前页', 'close'),
        '<div class="menu-sep"></div>',
        menuItemHTML('文字识别 (OCR)', 'ocr'),
        menuItemHTML('编辑 PDF 内容', 'editText'),
        '<div class="menu-sep"></div>',
        menuItemHTML('文档属性', 'info'),
        menuItemHTML('快捷键', 'menu'),
        menuItemHTML('设为默认 PDF 阅读器', 'file'),
        menuItemHTML('关于', 'info'),
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
      ['rect', '矩形'],
      ['ellipse', '椭圆'],
      ['line', '直线'],
      ['arrow', '箭头'],
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
        ${colorMenuHTML('线条颜色', App.COLORS.shape, o.shapeColor)}`
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
    const themeLabel = { light: '浅色', dark: '深色', system: '跟随系统' };
    const menu = showMenu(
      anchor,
      [
        `<div class="menu-title">外观主题</div>`,
        `<div class="menu-item" data-t="light"><span>浅色</span><span class="kbd">${s.theme === 'light' ? '✓' : ''}</span></div>`,
        `<div class="menu-item" data-t="dark"><span>深色</span><span class="kbd">${s.theme === 'dark' ? '✓' : ''}</span></div>`,
        `<div class="menu-item" data-t="system"><span>跟随系统</span><span class="kbd">${s.theme === 'system' ? '✓' : ''}</span></div>`,
        '<div class="menu-sep"></div>',
        menuItemHTML('快捷键', 'menu'),
        menuItemHTML('关于', 'info'),
      ].join(''),
      { alignRight: true }
    );
    menu.querySelectorAll('.menu-item[data-t]').forEach((el) => {
      el.onclick = () => {
        const t = el.dataset.t;
        S().settings.theme = t;
        window.api.setSettings({ theme: t });
        applyTheme(t);
        closeMenus();
      };
    });
    const items = menu.querySelectorAll('.menu-item:not([data-t])');
    items[0].onclick = () => {
      closeMenus();
      showShortcuts();
    };
    items[1].onclick = () => {
      closeMenus();
      showAbout();
    };
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
      toast('请先打开一个 PDF 文件');
      return false;
    }
    // 用内容指纹判断：撤销回初始状态后按 Ctrl+S 也要能把文件改回去，
    // 所以不能再用「有没有标注」作为门槛
    const snap = App.history.snapshot();
    if (!as && st.savedFingerprint === snap) {
      toast('没有需要保存的修改');
      return true;
    }
    App.viewer.showLoading('正在保存…');
    try {
      const bytes = await App.exporter.build();
      let target = st.filePath;
      if (as || !target) {
        const res = await window.api.saveAs(st.fileName || '未命名.pdf', bytes);
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
      toast('已保存：' + name);
      return true;
    } catch (e) {
      console.error(e);
      App.viewer.hideLoading();
      toast('保存失败：' + e.message);
      return false;
    }
  }

  /* ============================== 打印 ============================== */
  async function doPrint() {
    const st = S();
    if (!st.pdfDoc) return;
    App.viewer.showLoading('正在准备打印…');
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
      if (!res.success && res.reason && res.reason !== 'cancelled') toast('打印未完成：' + res.reason);
    } catch (e) {
      console.error(e);
      App.viewer.hideLoading();
      toast('打印失败：' + e.message);
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
  function toggleTwoUp() {
    S().twoUp = !S().twoUp;
    const pagesEl = App.viewer.getEl().pages;
    if (pagesEl) pagesEl.classList.toggle('two-up', S().twoUp);
    $('btn-viewmode').classList.toggle('active', S().twoUp);
    App.viewer.onResize();
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
      toast('请先选中文本');
      return false;
    }
    const done = () => toast(`已复制 ${text.length} 个字符`);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        try {
          document.execCommand('copy');
          done();
        } catch (e) {
          toast('复制失败');
        }
      });
    } else {
      try {
        document.execCommand('copy');
        done();
      } catch (e) {
        toast('复制失败');
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
    toast('已选中全部文本，按 Ctrl+C 复制');
  }

  /* ============================== 弹窗 ============================== */
  function showModal(title, bodyHTML, footButtons = [{ label: '关闭', primary: true }]) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHTML;
    const foot = $('modal-foot');
    foot.innerHTML = '';
    for (const b of footButtons) {
      const btn = document.createElement('button');
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
      toast('请先打开 PDF 文件');
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
      '文档属性',
      `<table>
        <tr><td>文件名</td><td>${escapeHtml(st.fileName || '-')}</td></tr>
        <tr><td>页数</td><td>${st.pages.length}</td></tr>
        <tr><td>文件大小</td><td>${size}</td></tr>
        <tr><td>标题</td><td>${escapeHtml(meta.Title || '-')}</td></tr>
        <tr><td>作者</td><td>${escapeHtml(meta.Author || '-')}</td></tr>
        <tr><td>创建时间</td><td>${fmt(meta.CreationDate)}</td></tr>
        <tr><td>修改时间</td><td>${fmt(meta.ModDate)}</td></tr>
      </table>`
    );
  }

  function showShortcuts() {
    const rows = [
      ['Ctrl + O', '打开文件'],
      ['Ctrl + S', '保存'],
      ['Ctrl + Shift + S', '另存为'],
      ['Ctrl + P', '打印'],
      ['Ctrl + F', '搜索'],
      ['Ctrl + Z / Ctrl + Y', '撤销 / 重做'],
      ['Ctrl + + / Ctrl + -', '放大 / 缩小'],
      ['Ctrl + 0', '适应页面'],
      ['PageUp / PageDown', '上一页 / 下一页'],
      ['H / D / E / T', '高亮 / 绘制 / 橡皮 / 文本'],
      ['Delete', '删除选中标注'],
      ['Esc', '退出当前工具'],
    ];
    showModal(
      '快捷键',
      `<table>${rows.map(([k, v]) => `<tr><td style="width:150px">${k}</td><td>${v}</td></tr>`).join('')}</table>`
    );
  }

  async function showAbout() {
    const v = await window.api.appVersion();
    showModal(
      '关于',
      `<div style="display:flex;gap:14px;align-items:center;margin-bottom:10px">
        <img src="assets/pdf-icon-256.png" style="width:56px;height:56px"/>
        <div><div style="font-size:15px;font-weight:600">PDF Reader</div>
        <div style="color:var(--text-dim);font-size:12px">版本 ${v.app}</div></div>
      </div>
      <div style="color:var(--text-dim);font-size:12.5px;line-height:1.7">
        界面与交互参照 Microsoft Edge 内置 PDF 阅读器设计，支持文本选择/复制、高亮、绘制、文本框，
        并提供 PDF 内容编辑（文字修改、插入文本/图片/形状、涂改遮盖、页面管理）与
        自研 OCR 文字识别（DB 文本检测 + CRNN/CTC 识别，纯 JS 实现，中英双语自动切换，可把扫描页转为可复制文本）。<br/>
        Electron ${v.electron} · Chromium ${v.chrome}
      </div>`
    );
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ============================== 右键菜单 ============================== */
  function showCtxMenu(x, y, items) {
    const menu = $('ctxMenu');
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
        menu.classList.add('hidden');
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
          toast('已删除标注');
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
        toast('仅支持 PDF 文件');
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
      showModal('保存更改？', '文档中有尚未保存的修改，是否在关闭前保存？', [
        { label: '取消' },
        { label: '不保存', onClick: () => window.api.allowClose() },
        {
          label: '保存',
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
      '有未保存的修改',
      `共有 ${dirty.length} 个标签页存在尚未保存的修改：<br/><span style="color:var(--text-dim)">${dirty
        .map((t) => escapeHtml(t.state.fileName || '新标签页'))
        .join('、')}</span>`,
      [
        { label: '取消' },
        { label: '不保存并关闭', onClick: () => window.api.allowClose() },
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
    openPath,
    showModal,
  };
})();
