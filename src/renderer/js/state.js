/* 全局状态与数据模型：每个标签页各自持有一份文档状态 */
(function () {
  const App = (window.App = window.App || {});

  const COLORS = {
    highlight: ['#ffe14d', '#a8e6a1', '#8fd3ff', '#ffb3c8', '#ff9d9d', '#d3b8f0'],
    pen: ['#e81123', '#0072c9', '#1b1b1b', '#107c10', '#ff8c00', '#8e44ad'],
    text: ['#1b1b1b', '#0072c9', '#e81123', '#107c10', '#ff8c00', '#ffffff'],
    shape: ['#0072c9', '#e81123', '#1b1b1b', '#107c10', '#ff8c00', '#8e44ad'],
  };

  let seq = 0;
  const newId = () => 'a' + Date.now().toString(36) + (seq++).toString(36);

  /** 跨标签页共享的设置（主题、OCR 语言、上次打开目录…） */
  App.settings = App.settings || {};

  /**
   * 创建一个「文档状态」。每个标签页一份，互不影响：
   * 页码、缩放、工具、标注、撤销栈、搜索结果、OCR 结果都随标签页走。
   */
  function createDocState() {
    return {
      /* 文档 */
      filePath: null,
      fileName: null,
      bytes: null,
      pdfDoc: null,
      numPagesSrc: 0,
      /** 显示页列表：{id, src|null, rot, wPt, hPt, el, ...} */
      pages: [],
      /** pageId -> 标注数组 */
      annots: new Map(),
      /* 视图 */
      zoom: 1,
      zoomMode: 'auto',
      currentPage: 0,
      twoUp: false,
      /* 工具 */
      tool: 'select',
      editMode: false,
      opts: {
        highlightColor: COLORS.highlight[0],
        penColor: COLORS.pen[1],
        penWidth: 3,
        textColor: COLORS.text[0],
        fontSize: 14,
        shapeKind: 'rect',
        shapeColor: COLORS.shape[0],
        shapeWidth: 2,
        eraserRadius: 14, // 橡皮圆点半径（屏幕 px）
      },
      selected: null, // {pageId, annotId}
      /* 其它 */
      dirty: false,
      /** 上次保存（或刚打开）时的内容指纹，用于判断是否真的有改动 */
      savedFingerprint: null,
      history: [],
      hIndex: -1,
      search: { query: '', matches: [], index: -1 },
      ocr: null,
      outline: null,
      /* 共享引用（保持旧代码 S().settings 可用） */
      settings: App.settings,
    };
  }

  const S = () => App.state;

  /* ------------------------------ 历史记录 ------------------------------ */
  function snapshot() {
    const s = S();
    const pages = s.pages.map((p) => ({
      id: p.id,
      src: p.src,
      rot: p.rot,
      baseW: p.baseW,
      baseH: p.baseH,
    }));
    const annots = {};
    // 剔除 _img（HTMLImageElement），否则每步撤销快照都会把整张 base64 图再存一份
    s.annots.forEach(
      (list, id) => (annots[id] = JSON.parse(JSON.stringify(list, (k, v) => (k === '_img' ? undefined : v))))
    );
    return JSON.stringify({ pages, annots });
  }

  function pushHistory() {
    const s = S();
    const snap = snapshot();
    if (s.history[s.hIndex] === snap) return;
    s.history = s.history.slice(0, s.hIndex + 1);
    s.history.push(snap);
    if (s.history.length > 80) s.history.shift();
    s.hIndex = s.history.length - 1;
    updateUndoButtons();
  }

  function resetHistory() {
    const s = S();
    s.history = [];
    s.hIndex = -1;
    pushHistory();
  }

  function restore(snap) {
    const s = S();
    const data = JSON.parse(snap);
    // 页面结构变化时才重建
    const changed =
      data.pages.length !== s.pages.length ||
      data.pages.some((p, i) => !s.pages[i] || s.pages[i].id !== p.id || s.pages[i].rot !== p.rot);
    s.annots = new Map();
    Object.entries(data.annots).forEach(([k, v]) => s.annots.set(k, v));
    if (changed) {
      App.viewer.setPageModel(data.pages);
    } else {
      App.viewer.refreshOverlays();
      App.viewer.renderThumbsIfOpen();
    }
    App.viewer.updatePageIndicator();
    updateUndoButtons();
  }

  function undo() {
    const s = S();
    if (s.hIndex <= 0) return;
    s.hIndex--;
    restore(s.history[s.hIndex]);
    s.dirty = true;
    App.ui.setTitle();
  }

  function redo() {
    const s = S();
    if (s.hIndex >= s.history.length - 1) return;
    s.hIndex++;
    restore(s.history[s.hIndex]);
    s.dirty = true;
    App.ui.setTitle();
  }

  function updateUndoButtons() {
    const s = S();
    const u = document.getElementById('btn-undo');
    const r = document.getElementById('btn-redo');
    if (u) u.disabled = s.hIndex <= 0;
    if (r) r.disabled = s.hIndex >= s.history.length - 1;
  }

  /* ------------------------------ 标注存取 ------------------------------ */
  function getAnnots(pageId) {
    const s = S();
    if (!s.annots.has(pageId)) s.annots.set(pageId, []);
    return s.annots.get(pageId);
  }

  function addAnnot(pageId, annot) {
    const s = S();
    annot.id = annot.id || newId();
    getAnnots(pageId).push(annot);
    s.dirty = true;
    pushHistory();
    App.viewer.refreshOverlays();
    App.ui.setTitle();
    return annot;
  }

  function removeAnnot(pageId, annotId) {
    const s = S();
    const list = getAnnots(pageId);
    const i = list.findIndex((a) => a.id === annotId);
    if (i >= 0) {
      list.splice(i, 1);
      s.dirty = true;
      pushHistory();
      App.viewer.refreshOverlays();
      App.ui.setTitle();
      return true;
    }
    return false;
  }

  function findAnnot(pageId, annotId) {
    return getAnnots(pageId).find((a) => a.id === annotId) || null;
  }

  App.state = createDocState();
  App.createDocState = createDocState;
  App.COLORS = COLORS;
  App.history = { push: pushHistory, reset: resetHistory, undo, redo, updateUndoButtons, snapshot };
  App.annots = { get: getAnnots, add: addAnnot, remove: removeAnnot, find: findAnnot };
})();
