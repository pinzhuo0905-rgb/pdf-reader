# Third-party components and assets

This project's own code is distributed under the [MIT](LICENSE) license. Below is the third-party
material shipped with the repository or the installer, and its license.

## Runtime dependencies

| Component | Version | License | Purpose |
| --- | --- | --- | --- |
| [Electron](https://www.electronjs.org/) | 33.x | MIT | Desktop runtime |
| [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | 3.11.174 | Apache-2.0 | PDF parsing and page rendering |
| [pdf-lib](https://pdf-lib.js.org/) | 1.17.1 | MIT | Writing annotations and page operations back into the PDF |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | 1.1.1 | MIT | Embedding custom TTF fonts (editing Chinese text) |
| [onnxruntime-node](https://github.com/microsoft/onnxruntime) | 1.20.x | MIT | Generic ONNX inference runtime (used by OCR) |

## OCR models and algorithmic references

| Item | Source | License |
| --- | --- | --- |
| `assets/models/det.onnx` | PP-OCRv4 detection model (PaddleOCR, converted to ONNX by [RapidOCR](https://github.com/RapidAI/RapidOCR)) | Apache-2.0 |
| `assets/models/rec.onnx` + `ppocr_keys_v1.txt` | PP-OCRv4 Chinese recognition model (6,623-character dictionary) | Apache-2.0 |
| `assets/models/rec_en.onnx` + `en_dict.txt` | PP-OCRv4 English recognition model (95-character dictionary) | Apache-2.0 |
| DB / CTC post-processing | Follows the PaddleOCR and RapidOCR Python implementations; **re-written in JavaScript in this repository** (`src/main/ocr/`) | Apache-2.0 |

> Papers: *Real-time Scene Text Detection with Differentiable Binarization* (AAAI 2020) and
> *SVTR: Scene Text Recognition with a Single Visual Model* (IJCAI 2022).

## Graphics

| Asset | Notes |
| --- | --- |
| `src/renderer/js/icons.js` | Every toolbar icon is hand-written SVG in this repository (MIT) |
| `build/icon.ico`, `assets/pdf-icon.ico`, `assets/pdf-icon-256.png` | The PDF document icon that **Microsoft Edge uses when it is the default PDF viewer**, extracted by `scripts/extract-edge-icon.mjs` from the icon group `#11 (IDR_X007_PDF_DOC)` inside `msedge.exe` |

> **About the icon**: the artwork is copyright Microsoft. The file is included here because the product
> requirement was to match the icon shown by the reference viewer; it is **not covered by the MIT
> license**. If you plan to publish, sell or redistribute this project, evaluate that yourself, or follow
> the "Replacing the application icon" section of the README and use your own artwork.

## Fonts

- The UI uses the system fonts Segoe UI and Microsoft YaHei; neither is bundled.
- The text-editing feature reads one Chinese font from the system font directory (for example
  `C:\Windows\Fonts\simhei.ttf`) at save time and **embeds a subset** containing only the glyphs that are
  actually used. The font file itself is never redistributed with this project.
