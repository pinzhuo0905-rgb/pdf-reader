'use strict';
/**
 * CRNN / SVTR + CTC 文本识别 —— 自研实现
 *
 * 原理：
 *  1. 预处理：把文本框裁剪图按高度 48 等比缩放（宽度上限 = 48 * 批次最大宽高比），
 *     归一化 (x/255-0.5)/0.5，右侧补 0 对齐成批次张量 [N,3,48,W]；
 *  2. 推理：输出每个时间步在字符集上的概率 [N,T,C]（C = blank + 字典 + 空格）；
 *  3. CTC 贪心解码：逐时间步取 argmax → 合并连续重复 → 去掉 blank(0) →
 *     按下标映射到字典字符，置信度取保留字符概率的均值。
 *
 * 参考实现：PaddleOCR CTCLabelDecode（Apache-2.0），本文件为 JS 重写。
 */

const ort = require('onnxruntime-node');
const { resizeBilinear, rotate90 } = require('./image');

const REC_HEIGHT = 48;
const MAX_RATIO = 320 / 48;
const MAX_REC_WIDTH = 960;
const MEAN = 0.5;
const STD = 0.5;

class TextRecognizer {
  /**
   * @param {ort.InferenceSession} session
   * @param {string[]} dictLines ppocr_keys_v1.txt 的每一行
   */
  constructor(session, dictLines) {
    this.session = session;
    this.dictLines = dictLines;
    this.chars = null; // 运行期按模型输出类别数自适应
  }

  buildChars(classCount) {
    const dict = this.dictLines;
    const withSpace = ['blank'].concat(dict, [' ']);
    if (classCount === withSpace.length) return withSpace;
    const noSpace = ['blank'].concat(dict);
    if (classCount === noSpace.length) return noSpace;
    // 兜底：多余类别用空串占位
    const arr = ['blank'].concat(dict);
    while (arr.length < classCount) arr.push('');
    return arr.slice(0, classCount);
  }

  /** 单图预处理（返回 RGB 缩放后的数据与宽度） */
  prepOne(crop, maxRatio) {
    let { data, width, height } = crop;
    // 竖排文本：高宽比过大则旋转 90°
    if (height / Math.max(1, width) >= 1.5) {
      const r = rotate90(data, width, height);
      data = r.data;
      width = r.width;
      height = r.height;
    }
    const ratio = width / Math.max(1, height);
    const targetW = Math.max(1, Math.min(Math.ceil(REC_HEIGHT * maxRatio), Math.ceil(REC_HEIGHT * ratio)));
    const resized = resizeBilinear(data, width, height, targetW, REC_HEIGHT);
    return { data: resized, width: targetW };
  }

  async runBatch(crops) {
    if (!crops.length) return [];
    // 批次宽度取 max(320/48, 批次最大宽高比)；上限 960 像素宽，
    // 避免超长文本行把推理时间拉长（超宽行会等比压缩，实测精度无明显损失）
    let maxRatio = MAX_RATIO;
    for (const c of crops) {
      const r = c.width / Math.max(1, c.height);
      if (r > maxRatio) maxRatio = r;
    }
    maxRatio = Math.min(maxRatio, MAX_REC_WIDTH / REC_HEIGHT);
    const batchW = Math.max(1, Math.ceil(REC_HEIGHT * maxRatio));

    const n = crops.length;
    const plane = REC_HEIGHT * batchW;
    const data = new Float32Array(n * 3 * plane);
    const preps = [];
    for (let i = 0; i < n; i++) {
      const p = this.prepOne(crops[i], maxRatio);
      preps.push(p);
      const base = i * 3 * plane;
      for (let y = 0; y < REC_HEIGHT; y++) {
        for (let x = 0; x < p.width; x++) {
          const si = (y * p.width + x) * 3;
          const di = y * batchW + x;
          data[base + di] = (p.data[si] / 255 - MEAN) / STD;
          data[base + plane + di] = (p.data[si + 1] / 255 - MEAN) / STD;
          data[base + plane * 2 + di] = (p.data[si + 2] / 255 - MEAN) / STD;
        }
      }
    }

    const input = new ort.Tensor('float32', data, [n, 3, REC_HEIGHT, batchW]);
    const feeds = { [this.session.inputNames[0]]: input };
    const out = await this.session.run(feeds);
    const tensor = out[this.session.outputNames[0]];
    const [nn, steps, classes] = tensor.dims;
    if (!this.chars) this.chars = this.buildChars(classes);

    const results = [];
    const probs = tensor.data;
    for (let b = 0; b < nn; b++) {
      results.push(this.ctcDecode(probs, b, steps, classes));
    }
    return results;
  }

  /** CTC 贪心解码 */
  ctcDecode(probs, batchIdx, steps, classes) {
    const offset = batchIdx * steps * classes;
    let prev = -1;
    let text = '';
    let probSum = 0;
    let probCount = 0;
    const chars = this.chars;
    for (let t = 0; t < steps; t++) {
      const base = offset + t * classes;
      let best = 0;
      let bestP = probs[base];
      for (let c = 1; c < classes; c++) {
        const p = probs[base + c];
        if (p > bestP) {
          bestP = p;
          best = c;
        }
      }
      if (best !== 0 && best !== prev) {
        const ch = chars[best];
        if (ch && ch !== 'blank') {
          text += ch;
          probSum += bestP;
          probCount++;
        }
      }
      prev = best;
    }
    return { text, score: probCount ? probSum / probCount : 0 };
  }
}

module.exports = { TextRecognizer, REC_HEIGHT };
