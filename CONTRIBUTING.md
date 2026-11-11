# 贡献指南

感谢你愿意改进这个项目。它是「界面纯净、功能丰富」的一次实践，所以我们同样看重**代码干净**和**功能扎实**。

## 1. 环境准备

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 18（推荐 20 / 22） | 构建与运行 |
| npm | ≥ 9 | 包管理 |
| Windows | 10 / 11 x64 | 当前只提供 Windows 安装包；核心代码是跨平台的 |

```bash
git clone https://github.com/pinzhuo0905-rgb/pdf-reader.git
cd pdf-reader
npm install          # 会自动执行 postinstall → scripts/prepare-vendor.mjs
npm start            # 开发模式启动
npm run dist         # 打包 Windows 安装包到 dist/
```

`npm install` 后会自动把 `pdfjs-dist` / `pdf-lib` / `fontkit` 的浏览器端构建产物复制到
`src/renderer/vendor/`（该目录不入库）。如果这一步失败，手动执行：

```bash
node scripts/prepare-vendor.mjs
```

## 2. 目录结构

```
src/
├── main/                  # 主进程（Node 侧）
│   ├── main.js            # 窗口、菜单、IPC、自定义 app:// 协议、打印
│   ├── preload.js         # contextBridge 暴露的受限 API
│   └── ocr/               # 自研 OCR 引擎（纯 JS 管线）
│       ├── image.js       # 双线性缩放、单应矩阵、透视采样
│       ├── det.js         # DB 检测后处理：连通域/凸包/最小外接矩形/unclip
│       ├── rec.js         # 识别预处理 + CTC 贪心解码
│       └── index.js       # 管线编排、中英模型切换
└── renderer/              # 渲染进程（无框架，原生 DOM）
    ├── index.html         # 工具栏 / 面板 / 浮层结构
    ├── css/app.css        # 全部样式（含深色主题变量）
    └── js/
        ├── icons.js       # 内联 SVG 图标集
        ├── state.js       # 全局状态 + 撤销/重做快照
        ├── viewer.js      # 渲染、缩放、懒加载、文本层、搜索、页面操作
        ├── annotate.js    # 标注绘制/命中测试/鼠标交互
        ├── textedit.js    # 就地改字（采样底色→遮盖→重排）
        ├── exporter.js    # 用 pdf-lib 把标注与页面操作写回 PDF
        ├── ocr.js         # OCR 面板
        ├── ui.js          # 工具栏、菜单、快捷键、保存/打印
        └── app.js         # 启动
```

**约定**：渲染进程不使用打包器与前端框架，脚本以经典 `<script>` 顺序加载，通过全局 `App`
命名空间通信（`App.viewer` / `App.annotate` / `App.ocr` / `App.ui` / `App.state`）。
新增文件时请同步更新 `index.html` 的脚本顺序。

## 3. 代码风格

- 2 空格缩进、单引号、语句末尾分号，与现有文件保持一致；
- 提交前请确保 `node --check <file>` 通过（本项目没有 ESLint 配置，但请保持零语法错误）；
- 注释用中文，写「为什么」而不是「是什么」；对外 API 用 JSDoc；
- 不要引入前端框架或打包器——「零构建、打开即读」是这个项目的卖点之一；
- 新增依赖前请先说明理由：能写 100 行解决的事情不要引入 10 MB 的库。

## 4. 提交信息

采用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat(ocr): 支持框选区域识别
fix(viewer): 修复旋转页面上标注坐标偏移
docs(readme): 补充快捷键表
refactor(exporter): 拆分坐标变换函数
perf(det): 连通域改用 Int32 栈，整页检测快 18%
```

## 5. 分支与 PR

1. 从 `main` 切出分支：`feat/xxx`、`fix/xxx`、`docs/xxx`；
2. 一个 PR 只做一件事，标题写清楚「改了什么 + 为什么」；
3. PR 描述里请附上**验证方式**（截图、自检输出、或手动步骤）；
4. 涉及 UI 的改动请附改动前后的截图（深色主题也要看一眼）；
5. 涉及 PDF 写出的改动，请说明是否影响已有文档的兼容性。

## 6. 自检脚本

仓库自带一套「无头窗口」端到端自检（窗口不显示，跑完自动退出），用来在改完代码后快速回归：

```bash
# 交互：高亮 / 画笔 / 文本框 / 橡皮 / 撤销 / 旋转
PDFREADER_TEST=test/e2e/interact.js npx electron . test/fixtures/sample.pdf

# OCR：整页识别 + 插入文本框 + 导出 PDF
PDFREADER_TEST=test/e2e/ocr.js npx electron . test/fixtures/sample.pdf

# 多标签页：打开/去重/排序/拖出成窗口/关闭/状态隔离 + 目录侧栏
PDFREADER_TEST=test/e2e/tabs.js npx electron . test/fixtures/sample.pdf

# 也可以直接跑封装好的脚本（自带延时与退出）
npm run test:interact
npm run test:ocr
npm run test:tabs

# 截图（输出到指定路径后退出）
PDFREADER_SHOT=shot.png npx electron . test/fixtures/sample.pdf
```

> Windows 下若用 Git Bash，注意 `PDFREADER_TEST=... npx electron` 的写法在 cmd/PowerShell 里需要改成 `set` / `$env:`。

## 7. 不要提交的东西

- `node_modules/`、`dist/`、`src/renderer/vendor/`（由脚本生成）
- 任何个人文档、带隐私内容的 PDF
- 新的第三方模型权重（>10 MB）请先开 Issue 讨论，避免仓库膨胀

## 8. 许可证

提交代码即表示你同意以 [MIT](./LICENSE) 许可证分发你的贡献。
