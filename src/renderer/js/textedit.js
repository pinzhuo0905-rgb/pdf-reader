/* 文字编辑：新增文本、修改已有文字（覆盖重写） */
(function () {
  const App = (window.App = window.App || {});
  const S = () => App.state;

  const el = {};
  let ctx = null; // {onCommit,onCancel}

  function init() {
    el.box = document.getElementById('textEditor');
    el.input = document.getElementById('textEditorInput');
    el.ok = document.getElementById('te-ok');
    el.cancel = document.getElementById('te-cancel');

    el.ok.addEventListener('click', commit);
    el.cancel.addEventListener('click', cancel);
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      }
    });
    App.viewer.getEl().scroll.addEventListener('scroll', () => {
      if (!el.box.classList.contains('hidden')) cancel();
    });
  }

  function open(opts) {
    ctx = opts;
    el.box.classList.remove('hidden');
    el.box.style.left = Math.max(8, Math.min(window.innerWidth - 320, opts.left)) + 'px';
    el.box.style.top = Math.max(56, Math.min(window.innerHeight - 140, opts.top)) + 'px';
    el.input.style.width = Math.max(200, opts.width || 240) + 'px';
    el.input.style.fontSize = Math.max(12, opts.fontSize || 14) + 'px';
    el.input.value = opts.initial || '';
    setTimeout(() => {
      el.input.focus();
      el.input.select();
    }, 0);
  }

  function commit() {
    if (!ctx) return;
    const text = el.input.value;
    const cb = ctx.onCommit;
    ctx = null;
    el.box.classList.add('hidden');
    if (cb) cb(text);
  }

  function cancel() {
    if (!ctx) return;
    const cb = ctx.onCancel;
    ctx = null;
    el.box.classList.add('hidden');
    if (cb) cb();
  }

  /* --------------------------- 采样页面像素颜色 --------------------------- */
  function sampleRegion(page, nx, ny, nw, nh) {
    const canvas = page.canvas;
    if (!canvas || !canvas.width) return { bg: '#ffffff', fg: '#1b1b1b' };
    const c = canvas.getContext('2d');
    const x0 = Math.max(0, Math.floor(nx * canvas.width));
    const y0 = Math.max(0, Math.floor(ny * canvas.height));
    const x1 = Math.min(canvas.width - 1, Math.ceil((nx + nw) * canvas.width));
    const y1 = Math.min(canvas.height - 1, Math.ceil((ny + nh) * canvas.height));
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    let data;
    try {
      data = c.getImageData(x0, y0, w, h).data;
    } catch {
      return { bg: '#ffffff', fg: '#1b1b1b' };
    }
    const hist = new Map();
    let darkest = { l: 1, c: [27, 27, 27] };
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)));
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2];
        const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (l > 0.72) {
          const key = (r >> 3) + ',' + (g >> 3) + ',' + (b >> 3);
          hist.set(key, (hist.get(key) || 0) + 1);
        }
        if (l < darkest.l) darkest = { l, c: [r, g, b] };
      }
    }
    let bg = '#ffffff';
    let best = 0;
    hist.forEach((v, k) => {
      if (v > best) {
        best = v;
        const [r, g, b] = k.split(',').map((n) => Number(n) * 8 + 4);
        bg = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
      }
    });
    const fg =
      darkest.l < 0.72
        ? '#' + darkest.c.map((n) => n.toString(16).padStart(2, '0')).join('')
        : '#1b1b1b';
    return { bg, fg };
  }

  /* ---------------------------- 命中已有文字 ---------------------------- */
  function itemAt(page, nx, ny) {
    const items = App.viewer.getTextItems(page.id);
    const W = page.wPt * S().zoom;
    const H = page.hPt * S().zoom;
    const x = nx * W;
    const y = ny * H;
    let best = null;
    let bestArea = Infinity;
    for (const it of items) {
      if (x >= it.left - 1 && x <= it.left + it.width + 1 && y >= it.top - 1 && y <= it.top + it.height + 2) {
        const area = it.width * it.height;
        if (area < bestArea) {
          best = it;
          bestArea = area;
        }
      }
    }
    return best;
  }

  /** 编辑工具点击：命中文字则覆盖重写，否则新建文本框 */
  function startAt(page, nx, ny) {
    const it = itemAt(page, nx, ny);
    if (!it) {
      App.annotate.openTextCreator(page, nx, ny);
      return;
    }
    editItem(page, it);
  }

  function editItem(page, it) {
    const W = page.wPt * S().zoom;
    const H = page.hPt * S().zoom;
    const rect = page.el.getBoundingClientRect();
    const sizePx = it.fontSize;
    // 覆盖框略作外扩，确保原文字（含上下伸部）被完全遮盖
    const padY = it.height * 0.1;
    const nx = it.left / W;
    const ny = (it.top - padY) / H;
    const nw = it.width / W;
    const nh = (it.height + padY * 1.9) / H;
    const sample = sampleRegion(page, nx, ny, nw, nh);

    open({
      left: rect.left + it.left,
      top: rect.top + it.top,
      width: Math.max(160, it.width + 60),
      fontSize: sizePx,
      initial: it.str,
      onCommit: (text) => {
        if (!text.trim() || text === it.str) return;
        // 估算新文本宽度
        const c = document.createElement('canvas').getContext('2d');
        c.font = `${sizePx}px ${App.annotate.FONT_STACK}`;
        const tw = c.measureText(text).width;
        const boxW = Math.max(it.width * 1.02, tw + 6);
        const lines = Math.ceil(tw / Math.max(20, boxW - 4));
        const boxH = it.height * Math.max(1, lines) * 1.05;
        App.annots.add(page.id, {
          type: 'textedit',
          x: nx,
          y: ny,
          w: Math.min(0.98, boxW / W),
          h: Math.min(0.98, boxH / H),
          text,
          size: sizePx / S().zoom,
          color: sample.fg,
          bg: sample.bg,
          align: 'left',
          cover: true,
        });
        App.ui.toast('已修改文字，保存后写入 PDF');
      },
    });
  }

  /** 双击已有文本标注：修改内容 */
  function editExisting(page, a) {
    const W = page.wPt * S().zoom;
    const H = page.hPt * S().zoom;
    const rect = page.el.getBoundingClientRect();
    open({
      left: rect.left + a.x * W,
      top: rect.top + a.y * H,
      width: Math.max(200, a.w * W),
      fontSize: Math.max(11, a.size * S().zoom),
      initial: a.text,
      onCommit: (text) => {
        if (!text.trim()) {
          App.annots.remove(page.id, a.id);
          return;
        }
        a.text = text;
        const c = document.createElement('canvas').getContext('2d');
        c.font = `${a.size * S().zoom}px ${App.annotate.FONT_STACK}`;
        const tw = c.measureText(text).width;
        a.w = Math.max(a.w, Math.min(0.98, (tw + 8) / W));
        S().dirty = true;
        App.history.push();
        App.viewer.refreshOverlays();
      },
    });
  }

  App.textedit = { init, open, startAt, editExisting, itemAt, sampleRegion };
})();
