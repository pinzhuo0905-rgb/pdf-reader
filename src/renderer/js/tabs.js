/* 多标签页：标签条、切换、关闭、拖拽排序与拖出为独立窗口 */
(function () {
  const App = (window.App = window.App || {});
  const $ = (id) => document.getElementById(id);

  const tabs = {
    list: [],
    activeId: null,
    seq: 0,
  };

  let drag = null; // { id, el, startX, startY, moved, ghost }
  let pendingActivate = null;

  const label = (t) => (t.state && t.state.fileName) || '新标签页';

  /* ============================== 初始化 ============================== */

  function init() {
    $('tab-new').onclick = () => createBlank(true);

    const strip = $('tabstrip');
    strip.addEventListener('pointerdown', onStripDown);
    strip.addEventListener('contextmenu', onTabContextMenu);
    strip.addEventListener('wheel', onStripWheel, { passive: false });
    // 双击空白处新建标签页（浏览器习惯）
    strip.addEventListener('dblclick', (e) => {
      if (!e.target.closest('.tab')) createBlank(true);
    });

    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);

    // 文件关联 / 从其它窗口拖出的标签页
    window.api.onOpenFile((payload) => {
      const p = typeof payload === 'string' ? { path: payload } : payload || {};
      if (p.path) openPath(p.path, p.page);
    });

    createBlank(true);
  }

  /* ============================== 标签页模型 ============================== */

  function find(id) {
    return tabs.list.find((t) => t.id === id) || null;
  }

  function active() {
    return find(tabs.activeId);
  }

  function createBlank(doActivate = true) {
    const t = {
      id: 't' + ++tabs.seq,
      state: App.createDocState(),
    };
    t.state.settings = App.settings;
    tabs.list.push(t);
    App.viewer.createView(t);
    // 后台新建：不抢焦点，视图保持隐藏
    if (doActivate) activate(t.id);
    else render();
    return t;
  }

  function activate(id) {
    if (App.viewer.isLoading && App.viewer.isLoading()) {
      pendingActivate = id;
      return;
    }
    const t = find(id);
    if (!t) return;
    tabs.activeId = id;
    App.state = t.state;
    t.state.settings = App.settings;
    App.viewer.bindTab(t);
    for (const x of tabs.list) {
      if (x.dom) x.dom.view.classList.toggle('active', x === t);
    }
    paintStrip();
    App.ui.syncTabUI(t);
    requestAnimationFrame(() => {
      if (tabs.activeId !== id) return;
      if (t.state.pdfDoc) {
        App.viewer.resumeView();
        App.viewer.refreshOverlays();
      }
    });
  }

  function flushPending() {
    if (pendingActivate) {
      const id = pendingActivate;
      pendingActivate = null;
      activate(id);
    }
  }

  function next(dir) {
    if (tabs.list.length < 2) return;
    const i = tabs.list.findIndex((t) => t.id === tabs.activeId);
    const n = (i + dir + tabs.list.length) % tabs.list.length;
    activate(tabs.list[n].id);
  }

  /* ============================== 打开文档 ============================== */

  const norm = (p) => (p ? String(p).replace(/\\/g, '/').toLowerCase() : '');

  async function openPath(path, page) {
    // 同一个文件已在某个标签页里打开时，直接切过去（Windows 路径大小写/斜杠不敏感）
    const key = norm(path);
    const same = tabs.list.find((t) => norm(t.state.filePath) === key);
    if (same) {
      activate(same.id);
      if (page) setTimeout(() => App.viewer.scrollToPage(page - 1, false), 60);
      return true;
    }
    const cur = active();
    const t = cur && !cur.state.pdfDoc && !cur.state.dirty ? cur : createBlank(true);
    if (tabs.activeId !== t.id) activate(t.id);

    try {
      const res = await window.api.readFile(path);
      const bytes = new Uint8Array(res.data);
      const ok = await App.viewer.load(bytes, res.path, res.name, { page });
      if (!ok) {
        close(t.id, true);
        return false;
      }
      $('empty').classList.add('hidden');
      refreshActive();
      return true;
    } catch (e) {
      console.error(e);
      App.ui.toast('打开失败：' + (e.message || e));
      close(t.id, true);
      return false;
    }
  }

  /** 拖放进来、没有真实路径的文件 */
  async function openBytes(bytes, name) {
    const cur = active();
    const t = cur && !cur.state.pdfDoc && !cur.state.dirty ? cur : createBlank(true);
    if (tabs.activeId !== t.id) activate(t.id);
    const ok = await App.viewer.load(bytes, null, name);
    if (ok) {
      $('empty').classList.add('hidden');
      refreshActive();
    } else {
      close(t.id, true);
    }
    return ok;
  }

  /* ============================== 关闭 ============================== */

  function close(id, force) {
    const t = find(id);
    if (!t) return;
    if (!force && t.state.dirty) {
      App.ui.showModal(
        '保存更改？',
        `“${escapeHtml(label(t))}”有尚未保存的修改，关闭前是否保存？`,
        [
          { label: '取消' },
          { label: '不保存并关闭', onClick: () => close(id, true) },
          {
            label: '保存并关闭',
            primary: true,
            onClick: async () => {
              const ok = await App.ui.saveTab(t);
              if (ok) close(id, true);
            },
          },
        ]
      );
      return;
    }

    const i = tabs.list.indexOf(t);
    tabs.list.splice(i, 1);
    App.viewer.destroyView(t);

    if (tabs.activeId === id) {
      const nextTab = tabs.list[Math.min(i, tabs.list.length - 1)];
      if (nextTab) activate(nextTab.id);
      else createBlank(true);
    } else {
      render();
    }
    if (!tabs.list.length) createBlank(true);
  }

  function closeOthers(id) {
    const skipped = [];
    for (const t of tabs.list.slice()) {
      if (t.id === id) continue;
      if (t.state.dirty) {
        skipped.push(label(t));
        continue;
      }
      close(t.id, true);
    }
    activate(id);
    if (skipped.length) App.ui.toast('已保留有未保存修改的标签页：' + skipped.join('、'));
  }

  function closeRight(id) {
    const i = tabs.list.findIndex((t) => t.id === id);
    if (i < 0) return;
    const skipped = [];
    for (const t of tabs.list.slice(i + 1)) {
      if (t.state.dirty) {
        skipped.push(label(t));
        continue;
      }
      close(t.id, true);
    }
    if (skipped.length) App.ui.toast('已保留有未保存修改的标签页：' + skipped.join('、'));
  }

  /* ============================== 渲染 ============================== */

  function render() {
    const strip = $('tabstrip');
    if (!strip) return;
    strip.innerHTML = '';
    for (const t of tabs.list) {
      const el = document.createElement('div');
      el.className = 'tab';
      el.dataset.id = t.id;
      if (t.id === tabs.activeId) el.classList.add('active');
      if (t.state.dirty) el.classList.add('dirty');
      el.title = t.state.filePath || '新标签页';

      const ico = document.createElement('img');
      ico.className = 'tab-ico';
      ico.src = 'assets/pdf-icon-256.png';
      ico.alt = '';
      if (!t.state.pdfDoc) ico.classList.add('dim');

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = label(t);

      const btn = document.createElement('button');
      btn.className = 'tab-close';
      btn.title = '关闭标签页 (Ctrl+W)';
      btn.innerHTML = Icons.svg('close');

      el.appendChild(ico);
      el.appendChild(title);
      el.appendChild(btn);
      strip.appendChild(el);
    }
    updateScrollable();
  }

  /** 标签过多时给标签条加渐隐提示 */
  function updateScrollable() {
    const strip = $('tabstrip');
    if (!strip) return;
    strip.classList.toggle('overflow', strip.scrollWidth > strip.clientWidth + 2);
  }

  /** 就地更新标签条（不重建 DOM，避免打断拖拽） */
  function paintStrip() {
    const strip = $('tabstrip');
    const els = strip ? [...strip.querySelectorAll('.tab')] : [];
    if (els.length !== tabs.list.length) {
      render();
      return;
    }
    tabs.list.forEach((x, i) => {
      const el = els[i];
      el.dataset.id = x.id;
      el.classList.toggle('active', x.id === tabs.activeId);
      el.classList.toggle('dirty', !!x.state.dirty);
      el.title = x.state.filePath || '新标签页';
      const title = el.querySelector('.tab-title');
      if (title && title.textContent !== label(x)) title.textContent = label(x);
      const ico = el.querySelector('.tab-ico');
      if (ico) ico.classList.toggle('dim', !x.state.pdfDoc);
    });
    updateScrollable();
  }

  function refreshActive() {
    const t = active();
    if (!t) return;
    paintStrip();
    document.title = t.state.fileName
      ? `${t.state.fileName}${t.state.dirty ? ' *' : ''} - PDF 阅读器`
      : 'PDF 阅读器';
  }

  /* ============================== 拖拽 ============================== */

  function onStripDown(e) {
    const tabEl = e.target.closest && e.target.closest('.tab');
    if (!tabEl) return;
    const id = tabEl.dataset.id;
    const t = find(id);
    if (!t) return;

    // 关闭按钮交给 click
    if (e.target.closest('.tab-close')) {
      e.preventDefault();
      close(id);
      return;
    }
    if (e.button !== 0) return;
    if (tabs.activeId !== id) activate(id);

    drag = { id, el: tabEl, startX: e.clientX, startY: e.clientY, moved: false, ghost: null };
  }

  function onDragMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;

    if (!drag.moved) {
      drag.moved = true;
      drag.el.classList.add('drag-src');
      const g = drag.el.cloneNode(true);
      g.className = 'tab tab-ghost';
      g.style.width = drag.el.offsetWidth + 'px';
      // 放进 #app 里，才能继承主题变量（颜色、阴影）
      (document.getElementById('app') || document.body).appendChild(g);
      drag.ghost = g;
    }

    drag.ghost.style.left = e.clientX - drag.el.offsetWidth / 2 + 'px';
    drag.ghost.style.top = e.clientY - drag.el.offsetHeight / 2 + 'px';

    const outside = !inStrip(e.clientX, e.clientY);
    drag.ghost.classList.toggle('detach', outside);
    drag.outside = outside;
    if (!outside) showDropHint(e.clientX);
    else hideDropHint();
  }

  function inStrip(x, y) {
    const r = $('tabbar').getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom + 6;
  }

  function showDropHint(clientX) {
    const hint = $('tabDrop');
    const strip = $('tabstrip');
    const els = [...strip.querySelectorAll('.tab')];
    let x = strip.getBoundingClientRect().left;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (clientX > r.left + r.width / 2) x = r.right;
      else break;
    }
    hint.style.left = Math.min(Math.max(x, strip.getBoundingClientRect().left), strip.getBoundingClientRect().right) + 'px';
    hint.classList.remove('hidden');
  }

  function hideDropHint() {
    $('tabDrop').classList.add('hidden');
  }

  function dropIndex(clientX) {
    const els = [...$('tabstrip').querySelectorAll('.tab')];
    let idx = els.length;
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) {
        idx = i;
        break;
      }
    }
    return idx;
  }

  function onDragUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    hideDropHint();
    if (d.ghost) d.ghost.remove();
    d.el.classList.remove('drag-src');
    if (!d.moved) return;

    const t = find(d.id);
    if (!t) return;

    if (inStrip(e.clientX, e.clientY)) {
      const from = tabs.list.indexOf(t);
      let to = dropIndex(e.clientX);
      if (from < to) to--;
      to = Math.max(0, Math.min(tabs.list.length - 1, to));
      if (to !== from) {
        tabs.list.splice(from, 1);
        tabs.list.splice(to, 0, t);
      }
      render();
      return;
    }
    detach(t, e.clientX, e.clientY);
  }

  /** 拖出标签条：交给主进程开一个新窗口，并把该文档搬过去 */
  function detach(t, x, y) {
    const st = t.state;
    if (!st.filePath) {
      App.ui.toast('该标签页还没有对应的文件，无法拖出为独立窗口');
      render();
      return;
    }
    if (st.dirty) {
      App.ui.toast('请先保存该标签页，再拖出为独立窗口');
      render();
      return;
    }
    window.api.detachTab({ path: st.filePath, page: st.currentPage + 1, x, y });
    close(t.id, true);
    App.ui.toast('已在新窗口中打开');
  }

  /* ============================== 标签右键菜单 ============================== */

  function onTabContextMenu(e) {
    const tabEl = e.target.closest && e.target.closest('.tab');
    if (!tabEl) return;
    e.preventDefault();
    const t = find(tabEl.dataset.id);
    if (!t) return;
    const items = [
      { label: '关闭标签页', icon: 'close', onClick: () => close(t.id) },
      { label: '关闭其他标签页', icon: 'close', onClick: () => closeOthers(t.id) },
      { label: '关闭右侧标签页', icon: 'close', onClick: () => closeRight(t.id) },
    ];
    if (t.state.filePath) {
      items.push(
        { label: '复制文件路径', icon: 'file', onClick: () => copyPath(t.state.filePath) },
        { label: '在文件夹中显示', icon: 'file', onClick: () => window.api.showItemInFolder(t.state.filePath) },
        {
          label: '在新窗口中打开',
          icon: 'expand',
          onClick: () => detach(t, 0, 0),
        }
      );
    }
    App.ui.showCtxMenu(e.clientX, e.clientY, items);
  }

  function copyPath(p) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(p).then(
        () => App.ui.toast('已复制路径'),
        () => App.ui.toast('复制失败')
      );
    }
  }

  function onStripWheel(e) {
    const strip = $('tabstrip');
    if (strip.scrollWidth <= strip.clientWidth + 2) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaY || e.deltaX;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  App.tabs = {
    init,
    list: tabs.list,
    active,
    find,
    createBlank,
    activate,
    flushPending,
    next,
    openPath,
    openBytes,
    close,
    closeOthers,
    refreshActive,
    detach,
  };
})();
