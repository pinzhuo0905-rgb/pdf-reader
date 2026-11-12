/* 标注：绘制、命中测试、鼠标交互 */
(function () {
  const App = (window.App = window.App || {});
  const S = () => App.state;

  const FONT_STACK = '"Microsoft YaHei", "Segoe UI", "PingFang SC", sans-serif';

  /* ------------------------------- 绘制 ------------------------------- */
  function paint(ctx, a, w, h, zoom, forExport) {
    ctx.save();
    switch (a.type) {
      case 'highlight': {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = a.color;
        ctx.globalAlpha = 0.55;
        for (const r of a.rects) ctx.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
        break;
      }
      case 'ink': {
        if (!a.points || a.points.length < 1) break;
        ctx.strokeStyle = a.color;
        ctx.lineWidth = Math.max(0.6, a.width * zoom);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const p0 = a.points[0];
        ctx.moveTo(p0.x * w, p0.y * h);
        if (a.points.length === 1) {
          ctx.lineTo(p0.x * w + 0.1, p0.y * h + 0.1);
        } else {
          for (let i = 1; i < a.points.length; i++) {
            const p = a.points[i];
            ctx.lineTo(p.x * w, p.y * h);
          }
        }
        ctx.stroke();
        break;
      }
      case 'whiteout': {
        ctx.fillStyle = a.color || '#ffffff';
        ctx.fillRect(a.x * w, a.y * h, a.w * w, a.h * h);
        break;
      }
      case 'shape': {
        drawShape(ctx, a, w, h, zoom);
        break;
      }
      case 'image': {
        if (a._img && a._img.complete) {
          ctx.drawImage(a._img, a.x * w, a.y * h, a.w * w, a.h * h);
        } else if (a.data) {
          const img = new Image();
          img.onload = () => {
            a._img = img;
            App.viewer.refreshOverlays();
          };
          img.src = a.data;
          a._img = img;
        }
        break;
      }
      case 'text':
      case 'textedit': {
        if (a.type === 'textedit' && a.cover !== false) {
          ctx.fillStyle = a.bg || '#ffffff';
          ctx.fillRect(a.x * w, a.y * h, a.w * w, a.h * h);
        }
        if (a.text) {
          const size = a.size * zoom;
          ctx.fillStyle = a.color || '#1b1b1b';
          ctx.font = `${size}px ${FONT_STACK}`;
          ctx.textBaseline = 'top';
          const maxW = a.w * w;
          const lines = wrapLines(ctx, a.text, maxW);
          const lh = size * 1.25;
          lines.forEach((line, i) => {
            const tw = ctx.measureText(line).width;
            let x = a.x * w;
            if (a.align === 'center') x += (maxW - tw) / 2;
            else if (a.align === 'right') x += maxW - tw;
            ctx.fillText(line, x, a.y * h + i * lh + (lh - size) * 0.35);
          });
        }
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  function drawShape(ctx, a, w, h, zoom) {
    const x = a.x * w;
    const y = a.y * h;
    const ww = a.w * w;
    const hh = a.h * h;
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = Math.max(0.6, (a.width || 2) * zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (a.kind === 'rect') {
      ctx.strokeRect(x, y, ww, hh);
    } else if (a.kind === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(x + ww / 2, y + hh / 2, Math.abs(ww / 2), Math.abs(hh / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (a.kind === 'line') {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + ww, y + hh);
      ctx.stroke();
    } else if (a.kind === 'arrow') {
      const x2 = x + ww;
      const y2 = y + hh;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const ang = Math.atan2(y2 - y, x2 - x);
      const len = Math.max(8, (a.width || 2) * zoom * 3.2);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - len * Math.cos(ang - 0.4), y2 - len * Math.sin(ang - 0.4));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - len * Math.cos(ang + 0.4), y2 - len * Math.sin(ang + 0.4));
      ctx.stroke();
    }
  }

  function wrapLines(ctx, text, maxWidth) {
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para) {
        out.push('');
        continue;
      }
      let line = '';
      for (const ch of para) {
        const test = line + ch;
        if (ctx.measureText(test).width > maxWidth && line) {
          out.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      out.push(line);
    }
    return out;
  }

  /* ------------------------------- 几何 ------------------------------- */
  function bbox(a) {
    if (a.type === 'highlight') {
      let x0 = 1,
        y0 = 1,
        x1 = 0,
        y1 = 0;
      for (const r of a.rects) {
        x0 = Math.min(x0, r.x);
        y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.x + r.w);
        y1 = Math.max(y1, r.y + r.h);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    if (a.type === 'ink') {
      let x0 = 1,
        y0 = 1,
        x1 = 0,
        y1 = 0;
      for (const p of a.points) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    return { x: a.x, y: a.y, w: a.w, h: a.h };
  }

  function hitTest(page, nx, ny) {
    const list = App.annots.get(page.id);
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      const b = bbox(a);
      const padX = 4 / (page.wPt * S().zoom);
      const padY = 4 / (page.hPt * S().zoom);
      if (nx >= b.x - padX && nx <= b.x + b.w + padX && ny >= b.y - padY && ny <= b.y + b.h + padY) {
        if (a.type === 'ink') {
          // 细线需要更精确的判断，但保留足够的容差方便点击
          const tol = Math.max(10, a.width * S().zoom + 6);
          for (const p of a.points) {
            const d = Math.hypot((p.x - nx) * page.wPt, (p.y - ny) * page.hPt) * S().zoom;
            if (d < tol) return a;
          }
          continue;
        }
        return a;
      }
    }
    return null;
  }

  function moveAnnot(a, dx, dy) {
    if (a.type === 'highlight') a.rects.forEach((r) => ((r.x += dx), (r.y += dy)));
    else if (a.type === 'ink') a.points.forEach((p) => ((p.x += dx), (p.y += dy)));
    else {
      a.x += dx;
      a.y += dy;
    }
  }

  /* ------------------------------ 交互实现 ------------------------------ */
  let drag = null;
  let pagesEl = null;
  let previewCanvas = null;

  function attachInteractions(container) {
    pagesEl = container;
    container.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('dblclick', onDblClick);
  }

  function pageFromEvent(e) {
    const el = e.target.closest ? e.target.closest('.page') : null;
    if (!el) return null;
    const p = S().pages.find((x) => x.el === el);
    if (!p) return null;
    const r = el.getBoundingClientRect();
    return {
      page: p,
      rect: r,
      nx: (e.clientX - r.left) / r.width,
      ny: (e.clientY - r.top) / r.height,
      px: e.clientX - r.left,
      py: e.clientY - r.top,
    };
  }

  function onDown(e) {
    if (e.button !== 0) return;
    const info = pageFromEvent(e);
    if (!info) return;
    const { page, nx, ny } = info;
    const tool = S().tool;

    // 文本选择工具下不拦截
    if (tool === 'select') {
      const a = hitTest(page, nx, ny);
      if (a) {
        S().selected = { pageId: page.id, annotId: a.id };
        App.viewer.refreshOverlays();
        drag = { kind: 'move', page, annot: a, startX: nx, startY: ny, moved: false };
        e.preventDefault();
      } else if (S().selected) {
        S().selected = null;
        App.viewer.refreshOverlays();
      }
      return;
    }

    if (tool === 'eraser') {
      const a = hitTest(page, nx, ny);
      if (a) {
        App.annots.remove(page.id, a.id);
        App.ui.toast('已删除标注');
      }
      return;
    }

    if (tool === 'textbox') {
      openTextCreator(page, nx, ny);
      return;
    }

    if (tool === 'image') {
      pickImage(page, nx, ny);
      return;
    }

    if (tool === 'textedit') {
      App.textedit.startAt(page, nx, ny);
      return;
    }

    if (tool === 'highlight' || tool === 'draw' || tool === 'whiteout' || tool === 'shape') {
      e.preventDefault();
      drag = {
        kind: 'draw',
        tool,
        page,
        startX: nx,
        startY: ny,
        curX: nx,
        curY: ny,
        points: [{ x: nx, y: ny }],
      };
      if (tool === 'highlight' || tool === 'whiteout' || tool === 'shape') {
        drawRubber(page, nx, ny, nx, ny);
      }
    }
  }

  function onMove(e) {
    if (!drag) return;
    const info = pageFromEvent(e);
    if (!info || info.page !== drag.page) return;
    drag.moved = true;
    if (drag.kind === 'move') {
      const dx = info.nx - drag.startX;
      const dy = info.ny - drag.startY;
      moveAnnot(drag.annot, dx, dy);
      drag.startX = info.nx;
      drag.startY = info.ny;
      App.viewer.refreshOverlays();
      return;
    }
    drag.curX = info.nx;
    drag.curY = info.ny;
    if (drag.tool === 'draw') {
      drag.points.push({ x: info.nx, y: info.ny });
      App.viewer.refreshOverlays();
      drawInkPreview(drag);
    } else {
      drawRubber(drag.page, drag.startX, drag.startY, info.nx, info.ny);
    }
  }

  function onUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    clearRubber();
    const page = d.page;
    if (d.kind === 'move') {
      if (d.moved) {
        S().dirty = true;
        App.history.push();
      }
      return;
    }
    if (d.tool === 'draw') {
      if (d.points.length < 2) d.points.push({ x: d.points[0].x + 0.0004, y: d.points[0].y + 0.0004 });
      App.annots.add(page.id, {
        type: 'ink',
        points: d.points,
        color: S().opts.penColor,
        width: S().opts.penWidth,
      });
      return;
    }
    const x = Math.min(d.startX, d.curX);
    const y = Math.min(d.startY, d.curY);
    const w = Math.abs(d.curX - d.startX);
    const h = Math.abs(d.curY - d.startY);

    if (d.tool === 'highlight') {
      const rects = highlightRects(page, x, y, w, h);
      if (!rects.length) return;
      App.annots.add(page.id, { type: 'highlight', rects, color: S().opts.highlightColor });
      return;
    }
    if (d.tool === 'whiteout') {
      if (w < 0.004 || h < 0.002) return;
      App.annots.add(page.id, { type: 'whiteout', x, y, w, h, color: '#ffffff' });
      return;
    }
    if (d.tool === 'shape') {
      if (w < 0.004 || h < 0.004) return;
      App.annots.add(page.id, {
        type: 'shape',
        kind: S().opts.shapeKind,
        x,
        y,
        w,
        h,
        color: S().opts.shapeColor,
        width: S().opts.shapeWidth,
      });
    }
  }

  function onDblClick(e) {
    const info = pageFromEvent(e);
    if (!info) return;
    const a = hitTest(info.page, info.nx, info.ny);
    if (a && (a.type === 'text' || a.type === 'textedit')) {
      App.textedit.editExisting(info.page, a);
    }
  }

  function onContextMenu(e) {
    const info = pageFromEvent(e);
    if (!info) return;
    const a = hitTest(info.page, info.nx, info.ny);
    if (!a) {
      // 未命中标注时，若存在文本选区则提供复制菜单
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).trim()) {
        e.preventDefault();
        App.ui.showCtxMenu(e.clientX, e.clientY, [
          { label: '复制', icon: 'file', onClick: () => App.ui.copySelection() },
          { label: '全选', icon: 'check', onClick: () => App.ui.selectAllText() },
        ]);
      }
      return;
    }
    e.preventDefault();
    S().selected = { pageId: info.page.id, annotId: a.id };
    App.viewer.refreshOverlays();
    App.ui.showCtxMenu(e.clientX, e.clientY, [
      {
        label: a.type === 'text' || a.type === 'textedit' ? '编辑文字' : '删除标注',
        icon: 'editText',
        onClick: () => {
          if (a.type === 'text' || a.type === 'textedit') App.textedit.editExisting(info.page, a);
          else {
            App.annots.remove(info.page.id, a.id);
            S().selected = null;
          }
        },
      },
      {
        label: '删除',
        icon: 'close',
        onClick: () => {
          App.annots.remove(info.page.id, a.id);
          S().selected = null;
        },
      },
    ]);
  }

  /* --------------------------- 高亮命中文字行 --------------------------- */
  function highlightRects(page, x, y, w, h) {
    const items = App.viewer.getTextItems(page.id);
    const left = x;
    const right = x + w;
    const top = y;
    const bottom = y + h;
    const rects = [];
    const W = page.wPt * S().zoom;
    const H = page.hPt * S().zoom;
    for (const it of items) {
      const iy = it.top;
      const ih = it.height;
      if (iy + ih < top * H || iy > bottom * H) continue;
      const il = it.left;
      const ir = it.left + it.width;
      const ol = Math.max(il, left * W);
      const or = Math.min(ir, right * W);
      if (or - ol <= 0.5) continue;
      const len = it.str.length || 1;
      const cw = it.width / len;
      const s = Math.max(0, Math.floor((ol - il) / cw));
      const e2 = Math.min(len, Math.ceil((or - il) / cw));
      if (e2 <= s) continue;
      rects.push({
        x: (il + s * cw) / W,
        y: (iy - ih * 0.06) / H,
        w: ((e2 - s) * cw) / W,
        h: (ih * 1.18) / H,
      });
    }
    if (!rects.length) {
      rects.push({ x, y, w, h });
    }
    return rects;
  }

  /* ------------------------------ 临时预览 ------------------------------ */
  function rubberCanvas(page) {
    if (!previewCanvas || previewCanvas._page !== page) {
      previewCanvas = document.createElement('canvas');
      previewCanvas.className = 'rubber';
      previewCanvas.style.position = 'absolute';
      previewCanvas.style.inset = '0';
      previewCanvas.style.pointerEvents = 'none';
      previewCanvas._page = page;
      page.el.appendChild(previewCanvas);
      syncRubberSize(page);
    }
    return previewCanvas;
  }

  function syncRubberSize(page) {
    if (!previewCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = page.wPt * S().zoom;
    const h = page.hPt * S().zoom;
    previewCanvas.width = Math.round(w * dpr);
    previewCanvas.height = Math.round(h * dpr);
    previewCanvas.style.width = w + 'px';
    previewCanvas.style.height = h + 'px';
  }

  function drawRubber(page, x0, y0, x1, y1) {
    const c = rubberCanvas(page);
    syncRubberSize(page);
    const dpr = window.devicePixelRatio || 1;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.scale(dpr, dpr);
    const w = page.wPt * S().zoom;
    const h = page.hPt * S().zoom;
    const x = Math.min(x0, x1) * w;
    const y = Math.min(y0, y1) * h;
    const ww = Math.abs(x1 - x0) * w;
    const hh = Math.abs(y1 - y0) * h;
    if (S().tool === 'highlight') {
      ctx.fillStyle = S().opts.highlightColor;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(x, y, ww, hh);
      ctx.globalAlpha = 1;
    } else if (S().tool === 'whiteout') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, ww, hh);
      ctx.strokeStyle = '#8a8a8a';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x, y, ww, hh);
    } else if (S().tool === 'shape') {
      drawShape(
        ctx,
        {
          kind: S().opts.shapeKind,
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          w: Math.abs(x1 - x0),
          h: Math.abs(y1 - y0),
          color: S().opts.shapeColor,
          width: S().opts.shapeWidth,
        },
        w,
        h,
        S().zoom
      );
    }
  }

  function drawInkPreview(d) {
    const c = rubberCanvas(d.page);
    syncRubberSize(d.page);
    const dpr = window.devicePixelRatio || 1;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.scale(dpr, dpr);
    const w = d.page.wPt * S().zoom;
    const h = d.page.hPt * S().zoom;
    ctx.strokeStyle = S().opts.penColor;
    ctx.lineWidth = S().opts.penWidth * S().zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    d.points.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h)));
    ctx.stroke();
  }

  function clearRubber() {
    if (previewCanvas && previewCanvas.parentNode) {
      previewCanvas.parentNode.removeChild(previewCanvas);
    }
    previewCanvas = null;
  }

  /* ------------------------------ 文本/图片 ------------------------------ */
  function openTextCreator(page, nx, ny) {
    const w = page.wPt * S().zoom;
    const h = page.hPt * S().zoom;
    const rect = page.el.getBoundingClientRect();
    App.textedit.open({
      left: rect.left + nx * w,
      top: rect.top + ny * h,
      width: Math.max(180, Math.min(420, w * 0.55)),
      fontSize: S().opts.fontSize * S().zoom,
      initial: '',
      onCommit: (text) => {
        if (!text.trim()) return;
        const boxW = Math.max(60, Math.min(420, w * 0.55));
        const lines = text.split('\n');
        const estH = lines.length * S().opts.fontSize * 1.35 + 4;
        App.annots.add(page.id, {
          type: 'text',
          x: nx,
          y: ny,
          w: boxW / w,
          h: Math.min(0.95, estH / h),
          text,
          size: S().opts.fontSize,
          color: S().opts.textColor,
          align: 'left',
        });
      },
    });
  }

  function pickImage(page, nx, ny) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('cancel', () => input.remove());
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result);
        const img = new Image();
        img.onload = () => {
          const w = page.wPt * S().zoom;
          const h = page.hPt * S().zoom;
          let dw = Math.min(img.width, w * 0.6);
          let dh = (img.height / img.width) * dw;
          if (dh > h * 0.8) {
            dh = h * 0.8;
            dw = (img.width / img.height) * dh;
          }
          App.annots.add(page.id, {
            type: 'image',
            x: nx,
            y: ny,
            w: dw / w,
            h: dh / h,
            data,
            _img: img,
          });
        };
        img.src = data;
      };
      reader.readAsDataURL(file);
      input.remove();
    });
    input.click();
  }

  App.annotate = {
    paint,
    bbox,
    hitTest,
    attachInteractions,
    moveAnnot,
    wrapLines,
    openTextCreator,
    FONT_STACK,
  };
})();
