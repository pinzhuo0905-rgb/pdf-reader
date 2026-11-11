#!/usr/bin/env node
/**
 * 重新生成 README 用的截图（无头运行，窗口不显示）。
 * 用法：npm run shots
 *
 * 截图按设备像素比输出（2x 屏为 2534×1634），如需缩小可用任意图片工具，
 * 或直接使用（GitHub 会自适应宽度）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const SHOTS = [
  ['test/e2e/scenes/01-reader.js', 'docs/screenshots/01-reader.png', 6000],
  ['test/e2e/scenes/02-annotate.js', 'docs/screenshots/02-annotate.png', 8000],
  ['test/e2e/scenes/03-ocr.js', 'docs/screenshots/03-ocr.png', 14000],
  ['test/e2e/scenes/04-search.js', 'docs/screenshots/04-search.png', 9000],
  ['test/e2e/scenes/05-tabs.js', 'docs/screenshots/05-tabs.png', 11000],
  ['test/e2e/scenes/06-tab-drag.js', 'docs/screenshots/06-tab-drag.png', 10000],
];

const isWin = process.platform === 'win32';
const electron = path.join('node_modules', '.bin', isWin ? 'electron.cmd' : 'electron');

function runOne(script, out, delay) {
  return new Promise((resolve) => {
    const child = spawn(electron, ['.', 'test/fixtures/sample.pdf'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PDFREADER_TEST: path.resolve(script),
        PDFREADER_SHOT: path.resolve(out),
        PDFREADER_SHOT_DELAY: String(delay),
      },
      shell: isWin,
    });
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

for (const [script, out, delay] of SHOTS) {
  console.log(`\n▶ 生成 ${out}`);
  const code = await runOne(script, out, delay);
  if (code !== 0) console.warn(`  退出码 ${code}`);
}
console.log('\n完成：docs/screenshots/');
