'use strict';
/**
 * 纯 JS 图像处理工具（OCR 专用）
 * - RGBA → RGB
 * - 双线性缩放
 * - 四点透视变换（求解单应矩阵 + 逆映射采样）
 * - 旋转 90°
 */

function rgbaToRgb(data, w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0, k = 0; i < w * h; i++, j += 4, k += 3) {
    out[k] = data[j];
    out[k + 1] = data[j + 1];
    out[k + 2] = data[j + 2];
  }
  return out;
}

/** 双线性缩放（RGB，输入输出均为 Uint8Array/Array） */
function resizeBilinear(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8Array(dw * dh * 3);
  const xRatio = sw / dw;
  const yRatio = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yRatio - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xRatio - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = sx - x0;
      const i00 = (y0 * sw + x0) * 3;
      const i01 = (y0 * sw + x1) * 3;
      const i10 = (y1 * sw + x0) * 3;
      const i11 = (y1 * sw + x1) * 3;
      const o = (y * dw + x) * 3;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - wx) + src[i01 + c] * wx;
        const bot = src[i10 + c] * (1 - wx) + src[i11 + c] * wx;
        out[o + c] = (top * (1 - wy) + bot * wy) | 0;
      }
    }
  }
  return out;
}

/** 高斯消元求解 n 元线性方程组 A x = b */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const t = M[pivot];
      M[pivot] = M[col];
      M[col] = t;
    }
    const pv = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * 求把 from 四点映射到 to 四点的单应矩阵（3x3，行主序）
 * from/to: [[x,y] x4]
 */
function getPerspectiveTransform(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** 逆映射透视采样：H 为 目标坐标 → 源坐标 的单应矩阵 */
function warpPerspective(src, sw, sh, H, dw, dh) {
  const out = new Uint8Array(dw * dh * 3);
  const [h0, h1, h2, h3, h4, h5, h6, h7] = H;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const den = h6 * px + h7 * py + 1;
      const sx = (h0 * px + h1 * py + h2) / den;
      const sy = (h3 * px + h4 * py + h5) / den;
      const o = (y * dw + x) * 3;
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
        out[o] = out[o + 1] = out[o + 2] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const wx = sx - x0;
      const wy = sy - y0;
      const i00 = (y0 * sw + x0) * 3;
      const i01 = (y0 * sw + x1) * 3;
      const i10 = (y1 * sw + x0) * 3;
      const i11 = (y1 * sw + x1) * 3;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - wx) + src[i01 + c] * wx;
        const bot = src[i10 + c] * (1 - wx) + src[i11 + c] * wx;
        out[o + c] = (top * (1 - wy) + bot * wy) | 0;
      }
    }
  }
  return out;
}

/** 顺时针旋转 90°（用于竖排文本转横排） */
function rotate90(src, w, h) {
  // 逆时针旋转 90°：新宽 = h，新高 = w
  const dw = h;
  const dh = w;
  const out = new Uint8Array(dw * dh * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = y;
      const ny = w - 1 - x;
      const si = (y * w + x) * 3;
      const di = (ny * dw + nx) * 3;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
    }
  }
  return { data: out, width: dw, height: dh };
}

/** 按四点裁剪（透视校正），box 顺序 [tl, tr, br, bl] */
function cropQuad(src, sw, sh, box) {
  const [tl, tr, br, bl] = box;
  const wTop = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
  const wBot = Math.hypot(br[0] - bl[0], br[1] - bl[1]);
  const hLeft = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
  const hRight = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
  const dw = Math.max(1, Math.round(Math.max(wTop, wBot)));
  const dh = Math.max(1, Math.round(Math.max(hLeft, hRight)));
  const H = getPerspectiveTransform(
    [
      [0, 0],
      [dw, 0],
      [dw, dh],
      [0, dh],
    ],
    [tl, tr, br, bl]
  );
  if (!H) return null;
  return { data: warpPerspective(src, sw, sh, H, dw, dh), width: dw, height: dh };
}

module.exports = {
  rgbaToRgb,
  resizeBilinear,
  getPerspectiveTransform,
  warpPerspective,
  rotate90,
  cropQuad,
};
