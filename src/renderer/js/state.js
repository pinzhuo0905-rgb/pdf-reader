/* 全局状态与数据模型 */
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

  const state = {
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
    },
    selected: null, // {pageId, annotId}
    /* 其它 */
    dirty: false,
    history: [],
    hIndex: -1,
    search: { query: '', matches: [], index: -1 },
    ocr: null,
    settings: {},
    COLORS,
    newId,
  };

  /* ------------------------------ 历史记录 ------------------------------ */
  function snapshot() {
    const pages = state.pages.map((p) => ({
      id: p.id,
      src: p.src,
      rot: p.rot,
      baseW: p.baseW,
      baseH: p.baseH,
    }));
    const annots = {};
    state.annots.forEach((list, id) => (annots[id] = JSON.parse(JSON.stringify(list))));
    return JSON.stringify({ pages, annots });
  }

  function pushHistory() {
    const snap = snapshot();
    if (state.history[state.hIndex] === snap) return;
    state.history = state.history.slice(0, state.hIndex + 1);
    state.history.push(snap);
    if (state.history.length > 80) state.history.shift();
    state.hIndex = state.history.length - 1;
    updateUndoButtons();
  }

  function resetHistory() {
    state.history = [];
    state.hIndex = -1;
    pushHistory();
  }

  function restore(snap) {
    const data = JSON.parse(snap);
    // 页面结构变化时才重建
    const changed =
      data.pages.length !== state.pages.length ||
      data.pages.some((p, i) => !state.pages[i] || state.pages[i].id !== p.id || state.pages[i].rot !== p.rot);
    state.annots = new Map();
    Object.entries(data.annots).forEach(([k, v]) => state.annots.set(k, v));
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
    if (state.hIndex <= 0) return;
    state.hIndex--;
    restore(state.history[state.hIndex]);
    state.dirty = true;
  }

  function redo() {
    if (state.hIndex >= state.history.length - 1) return;
    state.hIndex++;
    restore(state.history[state.hIndex]);
    state.dirty = true;
  }

  function updateUndoButtons() {
    const u = document.getElementById('btn-undo');
    const r = document.getElementById('btn-redo');
    if (u) u.disabled = state.hIndex <= 0;
    if (r) r.disabled = state.hIndex >= state.history.length - 1;
  }

  /* ------------------------------ 标注存取 ------------------------------ */
  function getAnnots(pageId) {
    if (!state.annots.has(pageId)) state.annots.set(pageId, []);
    return state.annots.get(pageId);
  }

  function addAnnot(pageId, annot) {
    annot.id = annot.id || newId();
    getAnnots(pageId).push(annot);
    state.dirty = true;
    pushHistory();
    App.viewer.refreshOverlays();
    return annot;
  }

  function removeAnnot(pageId, annotId) {
    const list = getAnnots(pageId);
    const i = list.findIndex((a) => a.id === annotId);
    if (i >= 0) {
      list.splice(i, 1);
      state.dirty = true;
      pushHistory();
      App.viewer.refreshOverlays();
      return true;
    }
    return false;
  }

  function findAnnot(pageId, annotId) {
    return getAnnots(pageId).find((a) => a.id === annotId) || null;
  }

  function hasAnnots() {
    for (const list of state.annots.values()) if (list.length) return true;
    return false;
  }

  App.state = state;
  App.COLORS = COLORS;
  App.history = { push: pushHistory, reset: resetHistory, undo, redo, updateUndoButtons };
  App.annots = { get: getAnnots, add: addAnnot, remove: removeAnnot, find: findAnnot, has: hasAnnots };
})();
