#!/usr/bin/env node
/**
 * 从 Microsoft Edge 安装目录中提取「PDF 文档」图标（图标组 #11 = IDR_X007_PDF_DOC），
 * 也就是 Edge 作为默认 PDF 查看器时资源管理器显示的那个图标。
 *
 * ⚠️ 该图标的美术资源版权归 Microsoft 所有。本仓库为「复刻 Edge 观感」而附带该图标，
 *    公开分发/商业使用前请自行确认合规，或改用你自己的图标（见 README「替换应用图标」）。
 *
 * 用法：
 *   node scripts/extract-edge-icon.mjs [msedge.exe 路径]
 * 产物：
 *   build/icon.ico        （应用图标 / 安装包图标）
 *   assets/pdf-icon.ico   （.pdf 文件关联图标）
 *   assets/pdf-icon-256.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let resedit;
try {
  resedit = require('resedit');
} catch {
  console.error('需要先安装 resedit：npm i -D resedit');
  process.exit(1);
}
const { NtExecutable, NtExecutableResource, Resource } = resedit;

function findEdge() {
  const bases = [
    'C:/Program Files (x86)/Microsoft/Edge/Application',
    'C:/Program Files/Microsoft/Edge/Application',
  ];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const versions = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d+\./.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) {
      const exe = path.join(base, v, 'msedge.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

/** 提取图标组（按序号）并组装为 ICO */
function extractIcon(exePath, groupIndex, outDir) {
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const group = groups[groupIndex];
  if (!group) throw new Error(`未找到图标组 #${groupIndex}`);

  const icons = new Map();
  for (const e of res.entries) if (e.type === 3) icons.set(e.id, Buffer.from(e.bin));

  const members = [];
  for (const it of group.icons) {
    const buf = icons.get(it.iconID);
    if (!buf) continue;
    members.push({ it, buf });
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(members.length, 4);
  let offset = 6 + 16 * members.length;
  const dirs = [];
  for (const m of members) {
    const e = Buffer.alloc(16);
    e.writeUInt8(m.it.width >= 256 ? 0 : m.it.width, 0);
    e.writeUInt8(m.it.height >= 256 ? 0 : m.it.height, 1);
    e.writeUInt8(m.it.colorCount || 0, 2);
    e.writeUInt16LE(m.it.planes || 1, 4);
    e.writeUInt16LE(m.it.bitCount || 32, 6);
    e.writeUInt32LE(m.buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += m.buf.length;
    dirs.push(e);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const icoPath = path.join(outDir, 'icon.ico');
  fs.writeFileSync(icoPath, Buffer.concat([header, ...dirs, ...members.map((m) => m.buf)]));

  // 顺便导出 256 尺寸 PNG（原始资源就是 PNG 压缩时可直接落盘）
  const big = members.find((m) => m.it.width === 0 || m.it.width >= 256);
  if (big && big.buf.readUInt32BE(0) === 0x89504e47) {
    fs.writeFileSync(path.join(outDir, 'icon-256.png'), big.buf);
  }
  return { icoPath, count: members.length };
}

const exe = process.argv[2] || findEdge();
if (!exe) {
  console.error('未找到 msedge.exe，请手动传入路径');
  process.exit(1);
}
console.log('[edge-icon] 使用', exe);
const { icoPath, count } = extractIcon(exe, 11, path.join(root, 'build'));
fs.copyFileSync(icoPath, path.join(root, 'assets', 'pdf-icon.ico'));
const png = path.join(root, 'build', 'icon-256.png');
if (fs.existsSync(png)) fs.copyFileSync(png, path.join(root, 'assets', 'pdf-icon-256.png'));
console.log(`[edge-icon] 完成：${count} 个尺寸 → build/icon.ico, assets/pdf-icon.ico`);
