# OCR 方案调研与自研实现说明

## 1. 调研过的开源方案

| 方案 | 技术路线 | 优点 | 不适合本项目的原因 |
| --- | --- | --- | --- |
| **Tesseract** (Apache-2.0) | 传统图像处理 + LSTM 行识别，无独立检测网络 | 老牌、离线、多语言 | 中文需要 15~30MB traineddata，复杂版面/倾斜/低质扫描件准确率明显偏低；无文本框几何输出 |
| **EasyOCR** (Apache-2.0) | CRAFT 检测 + CRNN 识别，PyTorch | 中文效果不错 | 依赖 PyTorch（>500MB），无法在 Electron 内嵌入 |
| **docTR** (Apache-2.0) | DBNet / LinkNet + CRNN，TensorFlow/PyTorch | 工程结构清晰 | 同样依赖重型深度学习框架 |
| **PaddleOCR** (Apache-2.0) | **DB/DB++ 检测 + SVTR/CRNN + CTC 识别** | 中文最强、模型小（mobile 版 det 4.7MB / rec 10.8MB）、可导出 ONNX | Python + Paddle 框架，不能直接嵌进 JS 应用 |
| **RapidOCR** (Apache-2.0) | 把 PaddleOCR 模型转到 ONNX 的**纯推理**实现（Python） | 无框架依赖、代码极简、后处理逻辑清晰，是最适合当参考实现的版本 | 仍是 Python |

**结论**：采用 PaddleOCR 的 **PP-OCRv4** 技术路线（DB 检测 + CTC 识别），以 **RapidOCR 的 Python 推理代码作为算法参考**，
把整条推理管线用 JavaScript 重新实现，模型权重使用公开预训练权重（训练需要海量数据与算力，不在本项目范围内）。

## 2. 参考的源码与文档

调研阶段下载并通读了以下材料（均 Apache-2.0，未纳入本仓库，可按下面的地址自行获取）：

| 材料 | 地址 | 用到的部分 |
| --- | --- | --- |
| PaddleOCR v2.9.1 源码 + 文档 | `https://codeload.github.com/PaddlePaddle/PaddleOCR/tar.gz/refs/tags/v2.9.1` | `doc/doc_ch/algorithm_det_db.md`（DB/DB++ 论文与指标）、`doc/doc_ch/algorithm_rec_crnn.md`、`ppocr/utils/ppocr_keys_v1.txt`（6623 字字典） |
| RapidOCR（PaddleOCR 的纯推理实现） | `https://codeload.github.com/RapidAI/RapidOCR/tar.gz/refs/heads/main` | `python/rapidocr/ch_ppocr_det/utils.py`（`DBPostProcess`）、`ch_ppocr_rec/utils.py`（`CTCLabelDecode`）、`utils/process_img.py`（透视裁剪）、`config.yaml`（阈值参数） |
| PP-OCRv4 ONNX 权重 | `https://www.modelscope.cn/models/RapidAI/RapidOCR` | `onnx/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.onnx`、`rec/ch_PP-OCRv4_rec_mobile.onnx`、`rec/en_PP-OCRv4_rec_mobile.onnx` |

本仓库中对应的自研实现：`src/main/ocr/{image,det,rec,index}.js`。

## 3. 核心原理

### 3.1 文本检测：DB（Differentiable Binarization，AAAI 2020）

传统做法是「分割概率图 → 固定阈值二值化」，阈值不可学习、后处理脆弱。DB 的做法是让网络**同时**预测概率图 P
和阈值图 T，用可微的近似二值化：

```
B(i,j) = 1 / (1 + e^(-k * (P(i,j) - T(i,j))))     # k = 50
```

B 用阶跃函数近似，可参与反向传播，于是「二值化」本身也被训练。推理时只需要 P（阈值 0.3），
T 与 B 仅用于训练监督（loss = L1(P, mask) + L1(B, label) + L1(T, label)）。

标签生成用 Vatti 裁剪把多边形按偏移量 D 收缩得到内核（kernel）：

```
D = A * (1 - r^2) / L        # A 面积, L 周长, r 收缩比例(0.4)
```

这也是**后处理 unclip 用同一个公式反向放大**的原因——网络学到的是收缩后的内核，必须按同样比例还原。

**后处理（本项目的 det.js 就是这一段的 JS 版）**：

1. P > 0.3 二值化 → 2×2 膨胀（连通被笔画断开的部分）；
2. 8 邻域连通域 → 凸包 → **最小外接矩形（旋转卡壳）**，短边 < 3px 丢弃；
3. 框内概率均值 = 置信度，< 0.5 丢弃；
4. **unclip**：`d = 面积 × 1.6 / 周长`，矩形沿两轴各外扩 d（等价于 pyclipper 圆角偏移后再取最小外接矩形）；
5. 还原到原图坐标 → 按 (tl,tr,br,bl) 顺时针排序 → 过滤宽高 ≤ 3 的框；
6. 阅读顺序：按 y 排序，相邻 y 差 ≥ 10px 视为新行，行内按 x 排序。

### 3.2 文本识别：CRNN/SVTR + CTC

- 输入按高 48 等比缩放，宽度取批次最大宽高比（PaddleOCR 的 `max(320/48, batch ratio)`），右侧补 0；
- 归一化 `(x/255 - 0.5)/0.5`，CHW 排布；
- 网络输出 `[N, T, C]`，C = blank + 6623 字典字 + 空格；
- **CTC 贪心解码**：逐时间步 argmax → 合并连续重复 → 去掉 blank(0) → 查字典；置信度取保留字符概率均值。

CTC 的价值在于不需要字符级标注对齐：同一字符连续出现时用 blank 隔开，网络自己学「何时输出、何时空」。

## 4. 自研实现（本项目代码，非部署现成方案）

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `src/main/ocr/image.js` | 183 | RGBA→RGB、双线性缩放、**四点单应矩阵求解（8×8 高斯消元）+ 逆映射透视采样**、90° 旋转 |
| `src/main/ocr/det.js` | 346 | DB 预处理/归一化/CHW、**连通域、凸包、旋转卡壳最小外接矩形、多边形内概率均值、unclip 外扩、顺时针排序、阅读顺序排序** |
| `src/main/ocr/rec.js` | 142 | 识别预处理（等比缩放/补零/归一化）、批处理、**CTC 贪心解码 + 字典映射** |
| `src/main/ocr/index.js` | 107 | 管线编排：检测 → 透视裁剪 → 按宽高比分批识别 → 还原阅读顺序 |
| `src/renderer/js/ocr.js` | 349 | 界面：整页/框选识别、结果面板、识别框叠加、复制、插入文本框 |

**唯一的第三方组件**是 `onnxruntime-node`——它只是通用张量推理运行时（相当于 BLAS），
不含任何 OCR 逻辑；OCR 的全部预处理、后处理、解码、版面排序都是本项目自己实现的 JS 代码。

### 4.1 中英双语

| 模式 | 模型 | 字典 | 适用 |
| --- | --- | --- | --- |
| 自动（默认） | 先用 ch 模型试识别前 6 行，无汉字且拉丁字母 ≥12 时切 en 模型 | — | 不确定文档语种 |
| 中文 + 英文 | `ch_PP-OCRv4_rec_mobile` | ppocr_keys_v1（6623 字） | 中文、中英混排 |
| 纯英文 | `en_PP-OCRv4_rec_mobile` | en_dict（95 字符） | 英文论文/表单，空格与标点更准 |

实测同一张英文图：ch 模型 `Answer -Nitrificationby nitrifyingbacteria`（空格丢失），
en 模型 `Answer - Nitrification by nitrifying bacteria`（完全正确），置信度 0.981 → 0.993。

## 5. 实测结果（本机 CPU，Electron 主进程内）

| 用例 | 结果 |
| --- | --- |
| 900×360 三行中英混排 | 3/3 行正确，330 ms（det 221 / rec 109） |
| 1400×1400 十三行中英混排 | 13/13 行正确，1.3 s（det 412 / rec 897） |
| A4 扫描页 1190×1684（1.6× 渲染） | 14 行，1.5~1.9 s（det ~450 / rec ~1.2 s） |
| 框选区域（页面中部一条） | 4 行，648 ms |
| 空白图 | 0 框，304 ms（不误检） |
| 英文三行（auto → en 模型） | 3/3 行正确含空格，616 ms |
| 中文三行（auto → ch 模型） | 3/3 行正确，313 ms |

已知局限：字号极小（<10px）时形近字可能混淆（实测「氮」→「氨」1 处）；纯空格在密集排版下可能被合并。
