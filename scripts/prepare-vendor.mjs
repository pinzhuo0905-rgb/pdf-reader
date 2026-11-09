#!/usr/bin/env node
/**
 * 把 npm 依赖里的第三方浏览器端构建产物复制到 src/renderer/vendor。
 * 这些文件不纳入版本库（见 .gitignore），npm install 后由 postinstall 自动执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const outDir = path.join(root, 'src', 'renderer', 'vendor');

const FILES = [
  ['pdfjs-dist/build/pdf.min.js', 'pdf.min.js'],
  ['pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js'],
  ['pdf-lib/dist/pdf-lib.min.js', 'pdf-lib.min.js'],
  ['@pdf-lib/fontkit/dist/fontkit.umd.min.js', 'fontkit.umd.min.js'],
];

const DIRS = [
  ['pdfjs-dist/cmaps', 'cmaps'],
  ['pdfjs-dist/standard_fonts', 'standard_fonts'],
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  ensureDir(to);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function main() {
  if (!fs.existsSync(nm)) {
    console.error('[prepare-vendor] 未找到 node_modules，请先运行 npm install');
    process.exit(1);
  }
  ensureDir(outDir);
  for (const [from, to] of FILES) {
    const src = path.join(nm, from);
    if (!fs.existsSync(src)) {
      console.error(`[prepare-vendor] 缺少依赖文件：${from}`);
      process.exit(1);
    }
    copyFile(src, path.join(outDir, to));
  }
  for (const [from, to] of DIRS) {
    const src = path.join(nm, from);
    if (fs.existsSync(src)) copyDir(src, path.join(outDir, to));
  }
  console.log('[prepare-vendor] 已就绪：src/renderer/vendor');
}

main();
