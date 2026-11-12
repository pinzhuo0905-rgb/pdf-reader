# 发布到 GitHub 的操作清单

这份文档把「仓库设置文案」和「命令步骤」放在一起，照着做即可上线。

---

## 0. 上线前先替换占位符

仓库里所有 `pinzhuo0905-rgb` 都要换成你的 GitHub 用户名（或组织名）：

```bash
# 在项目根目录执行（Git Bash / macOS / Linux）
grep -rl "pinzhuo0905-rgb" . --exclude-dir=node_modules --exclude-dir=dist \
  | xargs sed -i 's/pinzhuo0905-rgb/你的用户名/g'
```

涉及文件：`README.md`、`CONTRIBUTING.md`、`package.json`、`docs/release-notes-v1.0.0.md`、
`.github/ISSUE_TEMPLATE/config.yml`。

同时把 `LICENSE` 里的 `PDF Reader contributors` 换成你的名字或 ID（版权人）。

---

## 1. 仓库信息（直接复制）

**Repository name**

```
pdf-reader
```

**Description（About 那一行，建议 ≤ 120 字符）**

```
界面纯净、功能丰富的 PDF 阅读器：复刻 Edge 阅读器观感，内置标注、改字、页面编辑与中英双语离线 OCR
```

英文版（想让国际用户也能搜到就把英文放前面）：

```
A clean-UI, feature-rich PDF reader — Edge-like toolbar with annotations, text editing and offline CN/EN OCR.
```

**Topics（20 个以内，逗号分隔）**

```
pdf  pdf-reader  pdf-editor  pdf-annotation  ocr  offline-ocr  chinese-ocr  paddleocr  onnxruntime
electron  javascript  desktop-app  windows  pdfjs  pdf-lib  edge-style  dark-mode  text-recognition
dbnet  crnn-ctc
```

**Website**：留空，或填 Release 页面。

**Social preview**：上传 `docs/screenshots/01-reader.png`（1280×640 裁一下更好看）。

**勾选项**

- [x] Releases
- [x] Issues
- [x] Discussions（可选）
- [ ] Wiki（不需要，文档都在 `docs/`）
- [ ] Projects（不需要）

---

## 1.5 懒人模式：一条命令完成 1~5 步

如果不想逐条敲，仓库里带了脚本（Windows PowerShell 5.1 即可运行）：

```powershell
# 在 PowerShell 里执行；若被执行策略拦截，先跑：
# Set-ExecutionPolicy -Scope Process Bypass -Force

# 预演：只替换占位符，不联网不推送
.\scripts\publish.ps1 -User 你的用户名 -DryRun

# 正式发布：建仓 → 设 Topics → 推送 → 打 tag → 发 Release → 上传安装包
.\scripts\publish.ps1 -User 你的用户名 -Token ghp_xxxxxxxx
```

令牌在 https://github.com/settings/tokens 生成（只勾 `repo`），**用完立刻撤销**。
脚本跑完会把 remote 里的 token 换回干净地址。

## 2. 首次提交（本地）

```bash
cd pdfreader

git init
git branch -M main

# 确认 .gitignore 生效：下面这些不应该出现在 git status 里
git status --short | head -30

git add .
git commit -m "feat: 首个公开版本 —— 界面纯净、功能丰富的 PDF 阅读器

- 复刻 Edge PDF 阅读器工具栏（一层、48px、无二级菜单）
- 文本选择/复制、全文搜索、缩略图、深色主题
- 标注：高亮（按行吸附）/画笔/橡皮/文本框/形状/图片/涂改 + 80 步撤销
- 内容编辑：点击原文改字、页面旋转/删除/插入，保存时写回 PDF
- 自研离线 OCR：DB 检测 + CRNN/CTC 识别，中英双语自动切换
"
```

> 如果 `git status` 里出现了 `node_modules/`、`dist/`、`src/renderer/vendor/`，说明 `.gitignore` 没生效，
> 检查是不是在错误的目录执行了 `git init`。

## 3. 创建远程仓库并推送

**方式 A：GitHub CLI（推荐）**

```bash
gh auth login                      # 首次使用需要登录
gh repo create pdf-reader --public --source=. --remote=origin --push \
  --description "界面纯净、功能丰富的 PDF 阅读器：复刻 Edge 阅读器观感，内置标注、改字、页面编辑与中英双语离线 OCR"
```

**方式 B：网页 + 手动**

1. 打开 https://github.com/new ，名称填 `pdf-reader`，**不要**勾选 "Add a README / .gitignore / license"；
2. 然后：

```bash
git remote add origin https://github.com/pinzhuo0905-rgb/pdf-reader.git
git push -u origin main
```

## 4. 设置 Topics 与描述

```bash
gh repo edit --add-topic pdf,pdf-reader,pdf-editor,pdf-annotation,ocr,offline-ocr,chinese-ocr,paddleocr,onnxruntime,electron,javascript,desktop-app,windows,pdfjs,pdf-lib,edge-style,dark-mode,text-recognition,dbnet,crnn-ctc
```

网页端：仓库首页右侧 **About → ⚙️**，粘贴上面的 Description 与 Topics。

## 5. 打标签并发布 Release

```bash
# 1) 本地打 tag 并推送
git tag -a v1.0.0 -m "v1.0.0 首个公开版本"
git push origin v1.0.0

# 2) 用文档里的发布说明创建 Release，并把安装包作为附件上传
gh release create v1.0.0 \
  "dist/PDFReader-Setup-1.0.0.exe" \
  --title "v1.0.0 —— 界面纯净，功能丰富" \
  --notes-file docs/release-notes-v1.0.0.md
```

网页端等价操作：Releases → Draft a new release → 选 `v1.0.0` → 标题/正文粘贴
`docs/release-notes-v1.0.0.md` → 上传 `PDFReader-Setup-1.0.0.exe` → Publish。

> ⚠️ **体积限制**：安装包约 150 MB。GitHub **普通文件**单文件上限 100 MB（超了 `git push` 会被拒），
> 而 **Release 附件**单文件上限 2 GB。所以安装包只能作为 Release 资产上传，
> 千万不要 `git add dist/` 或 `git add -f`（`dist/` 已在 `.gitignore` 里）。

## 6. 发布后自检

- [ ] 仓库首页 README 的 4 张截图都能正常显示（路径 `docs/screenshots/*.png`）
- [ ] 右侧 About 显示描述与 Topics，语言统计显示 JavaScript
- [ ] License 被识别为 MIT（仓库首页右侧出现 "MIT license"）
- [ ] Issue 模板生效：新建 Issue 时能看到 🐛 / ✨ 两个模板
- [ ] Release 页面的附件能下载，SHA256 与文档一致
- [ ] 换台干净机器（或删掉 `node_modules`）跑一遍 `npm install && npm start`，确认能从零构建
- [ ] `git clone` 后 `npm run test:interact` 通过

## 7. 几个容易踩的坑

| 坑 | 说明 |
| --- | --- |
| 安装包进了仓库 | `dist/` 已在 `.gitignore`，别用 `git add -f` 强行加；走 Release 附件 |
| 模型权重过大 | `assets/models/*.onnx` 共 23 MB，单文件最大 10.8 MB，可正常入库；后续换更大模型请用 LFS |
| 换行符 | Windows 上提交可能出现 CRLF 噪声，建议 `git config core.autocrlf input` |
| 图标版权 | `build/icon.ico` 复刻自 Edge，见 `THIRD-PARTY-NOTICES.md`；公开分发前请自行确认或替换 |
| 未签名安装包 | SmartScreen 会提示「未知发布者」，在 Release 说明里写清楚，避免用户以为有毒 |
