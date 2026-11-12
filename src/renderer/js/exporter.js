/* 导出：把标注与页面操作写入 PDF 文件（pdf-lib） */
(function () {
  const App = (window.App = window.App || {});
  const S = () => App.state;

  let fontBytes = null;
  let fontCache = new WeakMap();

  async function getFont(pdfDoc, needed) {
    if (!needed) return null;
    if (window.fontkit && !pdfDoc.fontkit) pdfDoc.registerFontkit(window.fontkit);
    if (fontCache.has(pdfDoc)) return fontCache.get(pdfDoc);
    try {
      if (!fontBytes) {
        const res = await window.api.loadCjkFont();
        fontBytes = res && res.data ? new Uint8Array(res.data) : null;
      }
      if (fontBytes) {
        const font = await pdfDoc.embedFont(fontBytes, { subset: true });
        fontCache.set(pdfDoc, font);
        return font;
      }
    } catch (e) {
      console.warn('embed cjk font failed', e);
    }
    const std = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
    fontCache.set(pdfDoc, std);
    return std;
  }

  /** 显示坐标（左上原点，单位 pt）→ PDF 用户坐标（左下原点） */
  function mapPoint(W, H, R, dx, dy) {
    switch (((R % 360) + 360) % 360) {
      case 90:
        return { x: dy, y: dx };
      case 180:
        return { x: W - dx, y: dy };
      case 270:
        return { x: W - dy, y: H - dx };
      default:
        return { x: dx, y: H - dy };
    }
  }

  function mapRect(W, H, R, x, y, w, h) {
    const a = mapPoint(W, H, R, x, y);
    const b = mapPoint(W, H, R, x + w, y + h);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  }

  /** 显示尺寸（考虑 /Rotate）：旋转 90/270 时宽高互换 */
  function dispSize(W, H, R) {
    const r = ((R % 360) + 360) % 360;
    return r % 180 === 0 ? { w: W, h: H } : { w: H, h: W };
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#000000');
    if (!m) return PDFLib.rgb(0, 0, 0);
    const n = parseInt(m[1], 16);
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  /* ------------------------------- 主流程 ------------------------------- */
  async function build() {
    const state = S();
    const { PDFDocument, degrees, LineCapStyle, BlendMode } = PDFLib;
    if (!state.bytes) throw new Error('没有可保存的文档');

    const src = await PDFDocument.load(state.bytes, { ignoreEncryption: true, updateMetadata: false });

    // 判断是否需要重建页面结构
    const structural =
      src.getPageCount() !== state.pages.length ||
      state.pages.some((p, i) => p.src !== i);

    let doc = src;
    if (structural) {
      doc = await PDFDocument.create();
      const copied = await doc.copyPages(
        src,
        state.pages.filter((p) => p.src != null).map((p) => p.src)
      );
      let ci = 0;
      for (const p of state.pages) {
        if (p.src == null) {
          doc.addPage([p.baseW, p.baseH]);
        } else {
          doc.addPage(copied[ci++]);
        }
      }
    }

    // 需要中文字体？
    let needFont = false;
    state.annots.forEach((list) => {
      for (const a of list) if ((a.type === 'text' || a.type === 'textedit') && a.text) needFont = true;
    });
    const font = needFont ? await getFont(doc, true) : null;

    for (let i = 0; i < state.pages.length; i++) {
      const model = state.pages[i];
      const page = doc.getPage(i);
      const R = ((model.rot % 360) + 360) % 360;
      page.setRotation(degrees(R));
      const W = page.getWidth();
      const H = page.getHeight();
      const list = App.annots.get(model.id);
      for (const a of list) {
        try {
          drawAnnot(doc, page, a, W, H, R, font, { degrees, LineCapStyle, BlendMode });
        } catch (e) {
          console.warn('draw annot failed', a.type, e);
        }
      }
    }

    doc.setProducer('PDF Reader');
    doc.setModificationDate(new Date());
    const bytes = await doc.save({ useObjectStreams: true });
    return bytes;
  }

  function drawAnnot(doc, page, a, W, H, R, font, lib) {
    const { degrees, LineCapStyle, BlendMode } = lib;
    const rgb = hexToRgb;
    // 标注坐标是「显示坐标系」的归一化值：宽高必须用旋转后的显示尺寸，
    // 否则 /Rotate 90/270 的页面上标注会整体错位（之前用未旋转的 W/H）
    const { w: DW, h: DH } = dispSize(W, H, R);
    switch (a.type) {
      case 'highlight': {
        for (const r of a.rects) {
          const rc = mapRect(W, H, R, r.x * DW, r.y * DH, r.w * DW, r.h * DH);
          page.drawRectangle({
            ...rc,
            color: rgb(a.color),
            opacity: 0.45,
            blendMode: BlendMode.Multiply,
            borderWidth: 0,
          });
        }
        break;
      }
      case 'whiteout': {
        const rc = mapRect(W, H, R, a.x * DW, a.y * DH, a.w * DW, a.h * DH);
        page.drawRectangle({ ...rc, color: rgb(a.color || '#ffffff'), opacity: 1, borderWidth: 0 });
        break;
      }
      case 'ink': {
        for (let i = 1; i < a.points.length; i++) {
          const p0 = mapPoint(W, H, R, a.points[i - 1].x * DW, a.points[i - 1].y * DH);
          const p1 = mapPoint(W, H, R, a.points[i].x * DW, a.points[i].y * DH);
          page.drawLine({
            start: p0,
            end: p1,
            thickness: a.width || 3,
            color: rgb(a.color),
            lineCap: LineCapStyle.Round,
          });
        }
        if (a.points.length === 1) {
          const p0 = mapPoint(W, H, R, a.points[0].x * DW, a.points[0].y * DH);
          page.drawLine({
            start: p0,
            end: { x: p0.x + 0.6, y: p0.y },
            thickness: a.width || 3,
            color: rgb(a.color),
            lineCap: LineCapStyle.Round,
          });
        }
        break;
      }
      case 'shape': {
        const rc = mapRect(W, H, R, a.x * DW, a.y * DH, a.w * DW, a.h * DH);
        if (a.kind === 'rect') {
          page.drawRectangle({
            ...rc,
            borderColor: rgb(a.color),
            borderWidth: a.width || 2,
            borderOpacity: 1,
          });
        } else if (a.kind === 'ellipse') {
          page.drawEllipse({
            x: rc.x + rc.width / 2,
            y: rc.y + rc.height / 2,
            xScale: Math.max(0.1, rc.width / 2),
            yScale: Math.max(0.1, rc.height / 2),
            borderColor: rgb(a.color),
            borderWidth: a.width || 2,
          });
        } else {
          const p0 = mapPoint(W, H, R, a.x * DW, a.y * DH);
          const p1 = mapPoint(W, H, R, (a.x + a.w) * DW, (a.y + a.h) * DH);
          page.drawLine({
            start: p0,
            end: p1,
            thickness: a.width || 2,
            color: rgb(a.color),
            lineCap: LineCapStyle.Round,
          });
          if (a.kind === 'arrow') {
            const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
            const len = Math.max(6, (a.width || 2) * 4);
            for (const s of [-0.42, 0.42]) {
              page.drawLine({
                start: p1,
                end: { x: p1.x - len * Math.cos(ang + s), y: p1.y - len * Math.sin(ang + s) },
                thickness: a.width || 2,
                color: rgb(a.color),
                lineCap: LineCapStyle.Round,
              });
            }
          }
        }
        break;
      }
      case 'image': {
        const bytes = dataUrlToBytes(a.data);
        const isPng = a.data.startsWith('data:image/png');
        const img = isPng ? doc.embedPng(bytes) : doc.embedJpg(bytes);
        const anchor = mapPoint(W, H, R, a.x * DW, (a.y + a.h) * DH);
        page.drawImage(img, {
          x: anchor.x,
          y: anchor.y,
          width: a.w * DW,
          height: a.h * DH,
          rotate: degrees(R),
        });
        break;
      }
      case 'text':
      case 'textedit': {
        if (a.type === 'textedit' && a.cover !== false) {
          const rc = mapRect(W, H, R, a.x * DW, a.y * DH, a.w * DW, a.h * DH);
          page.drawRectangle({ ...rc, color: rgb(a.bg || '#ffffff'), borderWidth: 0 });
        }
        if (!a.text || !font) break;
        drawTextBox(page, a, W, H, R, font, degrees, rgb);
        break;
      }
      default:
        break;
    }
  }

  function drawTextBox(page, a, W, H, R, font, degrees, rgb) {
    const size = a.size || 14;
    const { w: DW, h: DH } = dispSize(W, H, R);
    const boxW = a.w * DW;
    const lines = wrapPdf(font, a.text, size, boxW);
    const lh = size * 1.25;
    lines.forEach((line, i) => {
      let dx = a.x * DW;
      const tw = font.widthOfTextAtSize(line, size);
      if (a.align === 'center') dx += (boxW - tw) / 2;
      else if (a.align === 'right') dx += boxW - tw;
      const dy = a.y * DH + i * lh + size * 0.86;
      const anchor = mapPoint(W, H, R, dx, dy);
      page.drawText(line, {
        x: anchor.x,
        y: anchor.y,
        size,
        font,
        color: rgb(a.color || '#1b1b1b'),
        rotate: degrees(R),
      });
    });
  }

  /** 页面是否被旋转过（相对打开文件时的原始角度） */
  function rotationChanged() {
    const norm = (v) => (((v || 0) % 360) + 360) % 360;
    return S().pages.some((p) => norm(p.rot) !== norm(p.origRot));
  }

  /** 页面是否有需要写入的内容 */
  function hasContent() {
    let n = 0;
    S().annots.forEach((l) => (n += l.length));
    // 只旋转页面、没有任何标注时也必须允许保存，否则旋转会丢失
    return n > 0 || isStructural() || rotationChanged();
  }

  function isStructural() {
    const st = S();
    if (!st.pdfDoc) return false;
    return st.pages.length !== st.numPagesSrc || st.pages.some((p, i) => p.src !== i);
  }

  App.exporter = { build, hasContent };
})();
