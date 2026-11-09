'use strict';
/**
 * DBNet（Differentiable Binarization）文本检测 —— 自研实现
 *
 * 原理：
 *  1. 预处理：按 limit_side_len 等比缩放（短边不小于 736），尺寸取 32 的整数倍，
 *     像素值归一化 (x/255 - 0.5) / 0.5，转成 CHW 张量；
 *  2. 推理：输出与原图同尺寸的「文字概率图」(probability map)；
 *  3. 后处理：阈值二值化 → 2x2 膨胀 → 连通域 → 凸包 → 最小外接矩形（旋转卡壳）
 *     → 框内平均概率作为置信度 → 按 unclip_ratio 向外扩（模拟 pyclipper 圆角偏移，
 *     扩完再取一次最小外接矩形，等价于沿两轴各外扩 d）→ 还原到原图坐标 → 顺时针排序。
 *
 * 参考实现：RapidOCR / PaddleOCR 的 DBPostProcess（Apache-2.0），本文件为 JS 重写。
 */

const ort = require('onnxruntime-node');
const { resizeBilinear } = require('./image');

const MEAN = 0.5;
const STD = 0.5;

class DBDetector {
  constructor(session, opts = {}) {
    this.session = session;
    this.limitSideLen = opts.limitSideLen || 736;
    this.maxSideLen = opts.maxSideLen || 1600;
    this.thresh = opts.thresh != null ? opts.thresh : 0.3;
    this.boxThresh = opts.boxThresh != null ? opts.boxThresh : 0.5;
    this.unclipRatio = opts.unclipRatio != null ? opts.unclipRatio : 1.6;
    this.useDilation = opts.useDilation !== false;
    this.minSize = 3;
    this.maxCandidates = opts.maxCandidates || 1000;
  }

  /** 计算网络输入尺寸 */
  resizePlan(w, h) {
    let ratio = 1;
    const minSide = Math.min(h, w);
    const maxSide = Math.max(h, w);
    if (minSide < this.limitSideLen) ratio = this.limitSideLen / minSide;
    if (maxSide * ratio > this.maxSideLen) ratio = this.maxSideLen / maxSide;
    const rw = Math.max(32, Math.round((w * ratio) / 32) * 32);
    const rh = Math.max(32, Math.round((h * ratio) / 32) * 32);
    return { rw, rh };
  }

  /** 归一化并转 CHW */
  toTensor(rgb, rw, rh) {
    const plane = rw * rh;
    const data = new Float32Array(plane * 3);
    for (let i = 0, n = plane; i < n; i++) {
      const r = rgb[i * 3];
      const g = rgb[i * 3 + 1];
      const b = rgb[i * 3 + 2];
      data[i] = (r / 255 - MEAN) / STD;
      data[plane + i] = (g / 255 - MEAN) / STD;
      data[plane * 2 + i] = (b / 255 - MEAN) / STD;
    }
    return new ort.Tensor('float32', data, [1, 3, rh, rw]);
  }

  async run(rgb, width, height) {
    const { rw, rh } = this.resizePlan(width, height);
    const resized = resizeBilinear(rgb, width, height, rw, rh);
    const input = this.toTensor(resized, rw, rh);
    const feeds = { [this.session.inputNames[0]]: input };
    const out = await this.session.run(feeds);
    const outName = this.session.outputNames[0];
    const tensor = out[outName];
    const dims = tensor.dims; // [1,1,rh,rw]
    const prob = tensor.data;
    const ph = dims[2];
    const pw = dims[3];
    const boxes = this.postprocess(prob, pw, ph, width, height);
    return boxes;
  }

  /* ------------------------------ 后处理 ------------------------------ */
  postprocess(prob, pw, ph, destW, destH) {
    // 1) 二值化
    let mask = new Uint8Array(pw * ph);
    for (let i = 0; i < mask.length; i++) mask[i] = prob[i] > this.thresh ? 1 : 0;
    // 2) 膨胀（2x2 核，向右侧/下侧扩张，与 cv2.dilate 行为接近）
    if (this.useDilation) mask = dilate2x2(mask, pw, ph);

    // 3) 连通域
    const comps = connectedComponents(mask, pw, ph);
    const boxes = [];
    const scores = [];
    for (let ci = 0; ci < comps.length && ci < this.maxCandidates; ci++) {
      const pixels = comps[ci];
      if (pixels.length < 4) continue;

      const hull = convexHull(pixels);
      const rect = minAreaRect(hull);
      if (!rect) continue;
      if (rect.sside < this.minSize) continue;

      const score = polygonMean(prob, pw, ph, rect.points);
      if (score < this.boxThresh) continue;

      // 4) unclip：distance = area * ratio / perimeter
      const area = rect.w * rect.h;
      const perimeter = 2 * (rect.w + rect.h);
      const d = (area * this.unclipRatio) / Math.max(1e-6, perimeter);
      const w2 = rect.w + 2 * d;
      const h2 = rect.h + 2 * d;
      if (Math.min(w2, h2) < this.minSize + 2) continue;

      const expanded = expandRect(rect, d);

      // 5) 还原到原图坐标
      const sx = destW / pw;
      const sy = destH / ph;
      const pts = expanded.map((p) => [
        clamp(Math.round(p[0] * sx), 0, destW - 1),
        clamp(Math.round(p[1] * sy), 0, destH - 1),
      ]);
      const ordered = orderPointsClockwise(pts);

      const rectW = dist(ordered[0], ordered[1]);
      const rectH = dist(ordered[0], ordered[3]);
      if (rectW <= 3 || rectH <= 3) continue;

      boxes.push(ordered);
      scores.push(score);
    }

    return sortBoxes(boxes, scores);
  }
}

/* --------------------------- 基础算法 --------------------------- */

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function dilate2x2(mask, w, h) {
  const out = new Uint8Array(mask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) continue;
      const up = y > 0 && mask[(y - 1) * w + x];
      const left = x > 0 && mask[y * w + x - 1];
      const ul = y > 0 && x > 0 && mask[(y - 1) * w + x - 1];
      if (up || left || ul) out[y * w + x] = 1;
    }
  }
  return out;
}

/** 8 邻域连通域，返回每个连通域的像素坐标数组 */
function connectedComponents(mask, w, h) {
  const visited = new Uint8Array(mask.length);
  const comps = [];
  const stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    visited[start] = 1;
    const pixels = [];
    while (sp > 0) {
      const idx = stack[--sp];
      const y = (idx / w) | 0;
      const x = idx - y * w;
      pixels.push([x, y]);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (mask[ni] && !visited[ni]) {
            visited[ni] = 1;
            stack[sp++] = ni;
          }
        }
      }
    }
    comps.push(pixels);
  }
  // 面积大的优先，避免被小噪点占满候选数
  comps.sort((a, b) => b.length - a.length);
  return comps;
}

/** Andrew monotone chain 凸包 */
function convexHull(points) {
  const pts = points.slice().sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (pts.length < 3) return pts;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * 最小外接矩形（旋转卡壳）
 * 返回 { points:[[x,y]x4], w, h, sside, ux,uy,vx,vy }
 */
function minAreaRect(hull) {
  if (!hull || hull.length < 3) return null;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];
    const ex = p2[0] - p1[0];
    const ey = p2[1] - p1[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    const ux = ex / len;
    const uy = ey / len;
    const vx = -uy;
    const vy = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const du = p[0] * ux + p[1] * uy;
      const dv = p[0] * vx + p[1] * vy;
      if (du < minU) minU = du;
      if (du > maxU) maxU = du;
      if (dv < minV) minV = dv;
      if (dv > maxV) maxV = dv;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (!best || area < best.area) {
      best = { area, w, h, ux, uy, vx, vy, minU, maxU, minV, maxV };
    }
  }
  if (!best) return null;
  const toXY = (u, v) => [u * best.ux + v * best.vx, u * best.uy + v * best.vy];
  const points = [
    toXY(best.minU, best.minV),
    toXY(best.maxU, best.minV),
    toXY(best.maxU, best.maxV),
    toXY(best.minU, best.maxV),
  ];
  return {
    points,
    w: best.w,
    h: best.h,
    sside: Math.min(best.w, best.h),
    ux: best.ux,
    uy: best.uy,
    vx: best.vx,
    vy: best.vy,
    minU: best.minU,
    maxU: best.maxU,
    minV: best.minV,
    maxV: best.maxV,
  };
}

/** 沿矩形两轴各向外扩 d（等价于圆角偏移后再取最小外接矩形） */
function expandRect(rect, d) {
  const toXY = (u, v) => [u * rect.ux + v * rect.vx, u * rect.uy + v * rect.vy];
  return [
    toXY(rect.minU - d, rect.minV - d),
    toXY(rect.maxU + d, rect.minV - d),
    toXY(rect.maxU + d, rect.maxV + d),
    toXY(rect.minU - d, rect.maxV + d),
  ];
}

/** 四边形内概率均值（扫描线填充） */
function polygonMean(prob, w, h, pts) {
  let sum = 0;
  let count = 0;
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= cy && b[1] > cy) || (b[1] <= cy && a[1] > cy)) {
        xs.push(a[0] + ((cy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    const xa = Math.max(0, Math.floor(xs[0]));
    const xb = Math.min(w - 1, Math.ceil(xs[xs.length - 1]));
    for (let x = xa; x <= xb; x++) {
      sum += prob[y * w + x];
      count++;
    }
  }
  return count ? sum / count : 0;
}

/** 顺时针排序：tl, tr, br, bl */
function orderPointsClockwise(pts) {
  const byX = pts.slice().sort((a, b) => a[0] - b[0]);
  const left = byX.slice(0, 2).sort((a, b) => a[1] - b[1]);
  const right = byX.slice(2, 4).sort((a, b) => a[1] - b[1]);
  const [tl, bl] = left;
  const [tr, br] = right;
  return [tl, tr, br, bl];
}

/** 先按 y 分行（10px 阈值），行内按 x 排序 */
function sortBoxes(boxes, scores) {
  if (!boxes.length) return [];
  const items = boxes.map((b, i) => ({ box: b, score: scores[i], y: b[0][1], x: b[0][0] }));
  items.sort((a, b) => a.y - b.y);
  let line = 0;
  for (let i = 1; i < items.length; i++) {
    if (items[i].y - items[i - 1].y >= 10) line++;
    items[i].line = line;
  }
  items[0].line = 0;
  items.sort((a, b) => (a.line - b.line) || (a.x - b.x));
  return items.map((it) => ({ box: it.box, score: it.score }));
}

module.exports = { DBDetector, sortBoxes, orderPointsClockwise };
