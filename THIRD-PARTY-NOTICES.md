# 第三方组件与资源声明

本项目自身代码以 [MIT](LICENSE) 分发。以下是随仓库或随安装包一起分发的第三方内容及其许可。

## 运行时依赖

| 组件 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| [Electron](https://www.electronjs.org/) | 33.x | MIT | 桌面运行时 |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | 3.11.174 | Apache-2.0 | PDF 解析与页面渲染 |
| [pdf-lib](https://pdf-lib.js.org/) | 1.17.1 | MIT | 标注与页面操作写回 PDF |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT | 自定义 TTF 字体嵌入（中文改字） |
| [onnxruntime-node](https://github.com/microsoft/onnxruntime) | 1.20.x | MIT | 通用 ONNX 推理运行时（OCR 用） |

## OCR 模型与算法参考

| 内容 | 来源 | 许可 |
| --- | --- | --- |
| `assets/models/det.onnx` | PP-OCRv4 检测模型（PaddleOCR，经 [RapidOCR](https://github.com/RapidAI/RapidOCR) 转为 ONNX） | Apache-2.0 |
| `assets/models/rec.onnx` + `ppocr_keys_v1.txt` | PP-OCRv4 中文识别模型（6623 字字典） | Apache-2.0 |
| `assets/models/rec_en.onnx` + `en_dict.txt` | PP-OCRv4 英文识别模型（95 字符字典） | Apache-2.0 |
| DB / CTC 后处理算法 | 参考 PaddleOCR、RapidOCR 的 Python 实现，**本项目用 JavaScript 重写**（`src/main/ocr/`） | Apache-2.0 |

> 算法论文：*Real-time Scene Text Detection with Differentiable Binarization* (AAAI 2020)、
> *SVTR: Scene Text Recognition with a Single Visual Model* (IJCAI 2022)。

## 图形资源

| 资源 | 说明 |
| --- | --- |
| `src/renderer/js/icons.js` | 全部工具栏图标为本仓库手写 SVG（MIT） |
| `build/icon.ico`、`assets/pdf-icon.ico`、`assets/pdf-icon-256.png` | **复刻 Microsoft Edge 作为默认 PDF 查看器时使用的 PDF 文档图标**，由 `scripts/extract-edge-icon.mjs` 从 `msedge.exe` 的图标组 `#11 (IDR_X007_PDF_DOC)` 提取 |

⚠️ **关于图标**：上述图标的原始美术资源版权归 Microsoft 所有。本仓库为满足「界面与图标与 Edge 一致」的
产品需求而附带该文件，**不属于 MIT 许可范围**。若你计划公开发布、商用或再分发，请自行评估合规性，
或按 README「替换应用图标」一节换成你自己的图标。

## 字体

- 界面字体使用系统自带的 Segoe UI / Microsoft YaHei，不随包分发；
- 「改字」功能在保存时会从系统字体目录（如 `C:\Windows\Fonts\simhei.ttf`）读取一个中文字体并**做子集嵌入**，
  只嵌入用到的字形，字体文件本身不随本项目分发。
