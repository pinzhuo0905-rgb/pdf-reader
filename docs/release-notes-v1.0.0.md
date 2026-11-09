# PDF Reader v1.0.0

> **界面纯净 · 功能丰富** —— 复刻 Microsoft Edge 内置 PDF 阅读器的观感，却把标注、改字、页面管理、离线 OCR 全部装了进去。

## 这个版本有什么

### 🫧 界面纯净

- 工具栏与 Edge PDF 阅读器同款布局：**一层 48px**，没有二级菜单迷宫
- 无启动页、无广告、无推荐、无「升级 Pro」、**无账号**
- **零联网**：断网可用，OCR 也在本地 CPU 上跑，不请求任何服务器
- 一个 exe 装完就能用，不依赖 WebView2 / .NET / Python 运行时

### 🧰 功能丰富

- **阅读**：连续滚动 / 双页、15%–500% 缩放、页码跳转、旋转、缩略图、全屏、朗读、打印、浅色/深色主题
- **文本**：拖选、双击选词、`Ctrl+A` 全选、`Ctrl+C` 复制、全文搜索（命中高亮 + 计数 + 上下跳转）
- **标注**：高亮（按文字行吸附）、画笔、橡皮、文本框、矩形/椭圆/直线/箭头、插入图片、涂改遮盖、80 步撤销重做
- **内容编辑**：点击原文就地**改字**（采样原文字色与底色 → 遮盖 → 按原字号重排，中文字体子集自动嵌入）；页面旋转 / 删除 / 插入空白页，保存时真正重排 PDF
- **OCR（自研）**：整页或框选区域识别；**中英双语**——中文模型（6623 字）+ 英文模型（95 字符），默认自动判定语种；识别框叠加、按行复制、一键插入为文本框

## 安装

1. 下载下方 `PDFReader-Setup-1.0.0.exe`（150 MB）
2. 双击安装，选择「仅为我安装」不需要管理员权限
3. 未做代码签名，首次运行 SmartScreen 可能提示「未知发布者」→ 更多信息 → 仍要运行
4. 装完可在「打开方式」里选择 **PDF 阅读器**；菜单 `☰ → 设为默认 PDF 阅读器` 可跳转系统设置

**文件校验**（本构建产物）：

```
SHA256  3797077434767CD22E00C472AE725FAC17E0E2BB9FAF17609D61937EB4C3EC63
```

```powershell
Get-FileHash .\PDFReader-Setup-1.0.0.exe -Algorithm SHA256
```

## 已知限制

- 改字采用「遮盖 + 重写」，不改写原文字流；扫描件请先 OCR 或直接用涂改 + 文本框
- 加密 PDF（需要密码）暂不支持；交互式表单暂不支持填写
- OCR 对极小字号（<10px）的形近字偶有混淆，密集排版的空格可能合并
- 仅提供 Windows x64 安装包；Linux / macOS 需自行 `npm run dist`

## 从源码构建

```bash
git clone https://github.com/pinzhuo0905-rgb/pdf-reader.git
cd pdf-reader
npm install
npm run dist
```

## 反馈

- 发现 Bug → [新建 Issue](https://github.com/pinzhuo0905-rgb/pdf-reader/issues/new?template=bug_report.md)
- 想要功能 → [功能建议](https://github.com/pinzhuo0905-rgb/pdf-reader/issues/new?template=feature_request.md)

**完整变更**：这是首个公开版本，没有历史对比。
