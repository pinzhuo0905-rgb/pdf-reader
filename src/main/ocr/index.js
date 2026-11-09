'use strict';
/**
 * OCR 管线：检测 → 裁剪（透视校正）→ 识别 → 结果组装
 *
 * 中英双语：
 *  - 中文模型 ch_PP-OCRv4_rec（6623 字，中英混排都能识别）
 *  - 英文模型 en_PP-OCRv4_rec（95 字符，纯英文的空格/标点更准）
 *  - 自动模式：先用中文模型试识别前几行，若几乎不含汉字则改用英文模型重跑
 */

const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const ort = require('onnxruntime-node');
const { DBDetector } = require('./det');
const { TextRecognizer } = require('./rec');
const { rgbaToRgb, cropQuad } = require('./image');

let state = null;
let loading = null;

const REC_BATCH = 8;
const PROBE_LINES = 6; // 自动模式用于判断语种的行数

function readDict(buf) {
  const lines = buf.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function sessionOpts() {
  return {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: Math.max(1, Math.min(4, os.cpus().length)),
  };
}

async function load(modelsDir) {
  if (state) return state;
  if (loading) return loading;
  loading = (async () => {
    const opts = sessionOpts();
    const [detBuf, chBuf, chDict] = await Promise.all([
      fs.readFile(path.join(modelsDir, 'det.onnx')),
      fs.readFile(path.join(modelsDir, 'rec.onnx')),
      fs.readFile(path.join(modelsDir, 'ppocr_keys_v1.txt'), 'utf8'),
    ]);
    const detSession = await ort.InferenceSession.create(new Uint8Array(detBuf), opts);
    const chSession = await ort.InferenceSession.create(new Uint8Array(chBuf), opts);
    state = {
      modelsDir,
      det: new DBDetector(detSession, { limitSideLen: 736, maxSideLen: 1600 }),
      recCh: new TextRecognizer(chSession, readDict(chDict)),
      recEn: null,
      enLoading: null,
    };
    return state;
  })();
  return loading;
}

/** 英文模型按需加载（只有英文/自动判定为英文时才载入） */
async function ensureEn() {
  const s = state;
  if (!s) throw new Error('OCR 引擎尚未初始化');
  if (s.recEn) return s.recEn;
  if (s.enLoading) return s.enLoading;
  s.enLoading = (async () => {
    const opts = sessionOpts();
    const [buf, dict] = await Promise.all([
      fs.readFile(path.join(s.modelsDir, 'rec_en.onnx')),
      fs.readFile(path.join(s.modelsDir, 'en_dict.txt'), 'utf8'),
    ]);
    const sess = await ort.InferenceSession.create(new Uint8Array(buf), opts);
    s.recEn = new TextRecognizer(sess, readDict(dict));
    return s.recEn;
  })();
  return s.enLoading;
}

/** 统计汉字 / 拉丁字母数量，用于语种判断 */
function scriptStats(text) {
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin++;
  }
  return { cjk, latin };
}

/**
 * @param {{width:number,height:number,data:Uint8Array|Uint8ClampedArray}} image RGBA
 * @param {string} modelsDir
 * @param {{lang?: 'auto'|'ch'|'en'}} opts
 */
async function recognize(image, modelsDir, opts = {}) {
  const s = await load(modelsDir);
  const lang = opts.lang || 'auto';
  const t0 = Date.now();
  const rgb = rgbaToRgb(image.data, image.width, image.height);

  const boxes = await s.det.run(rgb, image.width, image.height);
  const tDet = Date.now();

  const crops = [];
  const meta = [];
  for (const item of boxes) {
    const c = cropQuad(rgb, image.width, image.height, item.box);
    if (!c || c.width < 2 || c.height < 2) continue;
    crops.push(c);
    meta.push({ box: item.box, detScore: item.score });
  }

  // 按宽高比排序后再分批，使同一批内的文本行宽度接近，减少 padding 带来的无效计算
  const order = crops.map((c, i) => ({ i, r: c.width / Math.max(1, c.height) }));
  order.sort((a, b) => a.r - b.r);
  const sorted = order.map((o) => crops[o.i]);
  const sortedMeta = order.map((o) => meta[o.i]);

  const results = new Array(sorted.length);

  /** 识别 [from, to) 区间的行 */
  const runRange = async (recognizer, from, to) => {
    for (let i = from; i < to; i += REC_BATCH) {
      const end = Math.min(to, i + REC_BATCH);
      const out = await recognizer.runBatch(sorted.slice(i, end));
      for (let j = 0; j < out.length; j++) {
        results[i + j] = {
          box: sortedMeta[i + j].box,
          detScore: sortedMeta[i + j].detScore,
          text: out[j].text,
          score: out[j].score,
        };
      }
    }
  };

  let usedLang = lang;
  const total = sorted.length;

  if (lang === 'en') {
    await runRange(await ensureEn(), 0, total);
    usedLang = 'en';
  } else if (lang === 'ch') {
    await runRange(s.recCh, 0, total);
    usedLang = 'ch';
  } else {
    // 自动：先用中文模型探测前几行
    const probeEnd = Math.min(PROBE_LINES, total);
    if (probeEnd > 0) await runRange(s.recCh, 0, probeEnd);
    let cjk = 0;
    let latin = 0;
    for (let i = 0; i < probeEnd; i++) {
      const st = scriptStats(results[i] ? results[i].text : '');
      cjk += st.cjk;
      latin += st.latin;
    }
    if (cjk === 0 && latin >= 12) {
      // 判定为纯英文：用英文模型整页重跑
      await runRange(await ensureEn(), 0, total);
      usedLang = 'en';
    } else {
      await runRange(s.recCh, probeEnd, total);
      usedLang = 'ch';
    }
  }

  // 恢复原始（阅读顺序）次序
  const ordered = new Array(total);
  order.forEach((o, k) => (ordered[o.i] = results[k]));
  const tRec = Date.now();

  return {
    lines: ordered.filter((l) => l && l.text && l.text.trim().length > 0),
    detCount: boxes.length,
    lang: usedLang,
    ms: tRec - t0,
    detMs: tDet - t0,
    recMs: tRec - tDet,
  };
}

function isReady() {
  return !!state;
}

module.exports = { recognize, load, isReady };
