/* 文字编辑：新增文本、修改已有文字（覆盖重写）
 *
 * 交互要点：编辑框直接贴在页面上（和 PDF 内容同一坐标系），
 * 看起来就是「在 PDF 里原地改字」，不再弹出一个带确定/取消的浮层。
 * 回车 / 点击别处 = 提交，Esc = 取消。
 */
(function () {
  const App = (window.App = window.App || {});
  const S = () => App.state;

  let active = null; // {page, box, input, onCommit, onCancel, closed}

  function init() {
    // 滚动 / 缩放前先落笔，避免编辑框和页面内容错位
    App.viewer.onScrollHook(() => commitIfOpen());
    App.viewer.onZoomHook(() => commitIfOpen());
    // 切换标签页时提交
    document.addEventListener('pointerdown', (e) => {
      if (!active) return;
      if (active.box.contains(e.target)) return;
      // 点在别处：先把正在编辑的内容落笔
      commitIfOpen();
    }, true);
  }

  function isOpen() {
    return !!active;
  }

  /**
   * @param {object} o
   *  page       页面对象（page.el 作为定位父元素）
   *  x,y,w,h    相对页面左上角的像素坐标/尺寸（当前缩放下的屏幕 px）
   *  fontSize   字号（屏幕 px）
   *  color/bg   文字色 / 底色
   *  initial    初始文本
   *  multiline  是否允许换行（Shift+Enter）
   */
  function open(o) {
    close(true);
    const page = o.page;
    if (!page || !page.el) return;

    const box = document.createElement('div');
    box.id = 'textEditor';
    box.className = 'inline-editor';

    const input = document.createElement('textarea');
    input.id = 'textEditorInput';
    input.spellcheck = false;
    input.value = o.initial || '';

    const fs = Math.max(9, o.fontSize || 14);
    const w = Math.max(40, o.w || 180);
    const h = Math.max(fs * 1.3, o.h || fs * 1.4);

    box.style.left = Math.round(o.x) + 'px';
    box.style.top = Math.round(o.y) + 'px';
    box.style.width = Math.round(w) + 'px';
    input.style.fontSize = fs.toFixed(2) + 'px';
    input.style.lineHeight = '1.25';
    // 与写回 PDF 时用的字体保持一致，编辑时看到的就是最终效果
    input.style.fontFamily = (App.annotate && App.annotate.FONT_STACK) || 'inherit';
    input.style.color = o.color || 'var(--text)';
    input.style.background = o.bg || 'transparent';
    input.style.height = Math.round(h) + 'px';
    if (o.align) input.style.textAlign = o.align;

    box.appendChild(input);
    page.el.appendChild(box);

    active = {
      page,
      box,
      input,
      onCommit: o.onCommit,
      onCancel: o.onCancel,
      multiline: !!o.multiline,
    };

    // 阻止事件冒泡到标注层（否则点编辑框会被当成「再建一个文本框」）
    const stop = (e) => e.stopPropagation();
    box.addEventListener('pointerdown', stop);
    box.addEventListener('mousedown', stop);
    box.addEventListener('dblclick', stop);

    input.addEventListener('input', autosize);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      }
    });
    input.addEventListener('blur', () => {
      // 失焦即落笔（关闭时已在内部置 closed，不会重复触发）
      setTimeout(() => {
        if (active && active.input === input) commit();
      }, 0);
    });

    setTimeout(() => {
      input.focus();
      // 光标放到末尾，方便直接在原文后面继续改
      const n = input.value.length;
      input.setSelectionRange(n, n);
      autosize();
    }, 0);
  }

  function autosize() {
    if (!active) return;
    const t = active.input;
    t.style.height = 'auto';
    t.style.height = Math.max(parseFloat(t.style.fontSize) * 1.3, t.scrollHeight) + 'px';
  }

  function teardown() {
    if (!active) return null;
    const a = active;
    active = null;
    if (a.box.parentNode) a.box.parentNode.removeChild(a.box);
    return a;
  }

  function commit() {
    const a = teardown();
    if (!a) return;
    const text = a.input.value;
    if (a.onCommit) a.onCommit(text);
  }

  function commitIfOpen() {
    if (active) commit();
  }

  function cancel() {
    const a = teardown();
    if (!a) return;
    if (a.onCancel) a.onCancel();
  }

  function close(silent) {
    if (!active) return;
    if (silent) {
      teardown();
    } else {
      cancel();
    }
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
    const items = page.textItems || App.viewer.getTextItems(page.id);
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
  async function startAt(page, nx, ny) {
    // 文本层坐标可能因为缩放/重绘被作废，先确保按当前缩放算好
    if (!page.textItems && page.src != null) {
      try {
        await App.viewer.ensureTextItems(page);
      } catch {
        /* 没有文本层时按新建文本框处理 */
      }
    }
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
    const sizePx = it.fontSize;
    // 覆盖框略作外扩，确保原文字（含上下伸部）被完全遮盖
    const padY = it.height * 0.1;
    const nx = it.left / W;
    const ny = (it.top - padY) / H;
    const nw = it.width / W;
    const nh = (it.height + padY * 1.9) / H;
    const sample = sampleRegion(page, nx, ny, nw, nh);

    open({
      page,
      x: it.left,
      y: it.top - padY,
      w: Math.max(60, it.width + 8),
      h: it.height + padY * 2,
      fontSize: sizePx,
      color: sample.fg,
      bg: sample.bg,
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
        App.ui.toast(window.t('toast.textEdited'));
      },
    });
  }

  /** 双击已有文本标注：修改内容 */
  function editExisting(page, a) {
    const W = page.wPt * S().zoom;
    const H = page.hPt * S().zoom;
    open({
      page,
      x: a.x * W,
      y: a.y * H,
      w: Math.max(60, a.w * W),
      h: Math.max(14, a.h * H),
      fontSize: Math.max(9, a.size * S().zoom),
      color: a.color || '#1b1b1b',
      bg: a.bg || 'transparent',
      initial: a.text,
      multiline: true,
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
        App.annotate.fitTextHeight(page, a);
        S().dirty = true;
        App.history.push();
        App.viewer.refreshOverlays();
      },
    });
  }

  App.textedit = {
    init,
    open,
    close,
    commit,
    commitIfOpen,
    cancel,
    isOpen,
    startAt,
    editExisting,
    itemAt,
    sampleRegion,
  };
})();
