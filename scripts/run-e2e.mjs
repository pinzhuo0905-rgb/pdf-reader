#!/usr/bin/env node
/**
 * 无头端到端自检运行器：以隐藏窗口启动应用，执行指定脚本后自动退出。
 *
 * 用法：node scripts/run-e2e.mjs test/e2e/ocr.js
 *       node scripts/run-e2e.mjs test/e2e/ocr.js --shot out.png
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// 测试用独立的用户数据目录：不能和用户正在使用的实例抢单实例锁，
// 也不要污染用户的 settings.json
const TEST_PROFILE = path.join(os.tmpdir(), 'pdfreader-e2e-profile');

const args = process.argv.slice(2);
const script = args[0];
if (!script) {
  console.error('用法：node scripts/run-e2e.mjs <场景脚本路径> [--shot out.png] [--delay 8000]');
  process.exit(1);
}

const shotIdx = args.indexOf('--shot');
const shot = shotIdx >= 0 ? args[shotIdx + 1] : null;
const delayIdx = args.indexOf('--delay');
const delay = delayIdx >= 0 ? args[delayIdx + 1] : '8000';

const isWin = process.platform === 'win32';
const electron = path.join('node_modules', '.bin', isWin ? 'electron.cmd' : 'electron');

const env = {
  ...process.env,
  PDFREADER_TEST: path.resolve(script),
  PDFREADER_SHOT_DELAY: delay,
};
// 父进程若带 ELECTRON_RUN_AS_NODE，Electron 会退化成纯 Node，app 为 undefined
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
delete env.NODE_OPTIONS;
if (shot) env.PDFREADER_SHOT = path.resolve(shot);

const child = spawn(electron, ['.', 'test/fixtures/sample.pdf', `--user-data-dir=${TEST_PROFILE}`], {
  stdio: 'inherit',
  env,
  shell: isWin,
});

child.on('exit', (code) => process.exit(code ?? 0));
