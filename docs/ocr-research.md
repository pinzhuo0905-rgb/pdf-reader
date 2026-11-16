# OCR: what we evaluated, and what we built

## 1. Open-source options considered

| Project | Approach | Strengths | Why it did not fit |
| --- | --- | --- | --- |
| **Tesseract** (Apache-2.0) | Classical image processing + LSTM line recognition, no separate detection network | Mature, offline, many languages | Chinese needs a 15–30 MB traineddata file, accuracy drops on complex layouts, skew and low-quality scans; no box geometry in the output |
| **EasyOCR** (Apache-2.0) | CRAFT detection + CRNN recognition, PyTorch | Good Chinese results | Requires PyTorch (>500 MB), cannot be embedded in Electron |
| **docTR** (Apache-2.0) | DBNet / LinkNet + CRNN, TensorFlow or PyTorch | Clean architecture | Same heavyweight framework dependency |
| **PaddleOCR** (Apache-2.0) | **DB/DB++ detection + SVTR/CRNN + CTC recognition** | Best-in-class Chinese, small mobile models (det 4.7 MB / rec 10.8 MB), exportable to ONNX | Python + Paddle runtime, cannot be embedded in a JS app |
| **RapidOCR** (Apache-2.0) | A **pure-inference** ONNX port of the PaddleOCR models (Python) | No framework dependency, minimal code, very readable post-processing — the best reference implementation | Still Python |

**Decision**: follow the PaddleOCR **PP-OCRv4** pipeline (DB detection + CTC recognition), use **RapidOCR's
Python inference code as the algorithmic reference**, and re-implement the entire inference pipeline in
JavaScript. Model weights are the public pre-trained ones (training needs data and compute that are out
of scope here).

## 2. Sources read during the research

Downloaded and read (all Apache-2.0; not vendored into this repo):

| Material | Location | What was used |
| --- | --- | --- |
| PaddleOCR v2.9.1 source + docs | `https://codeload.github.com/PaddlePaddle/PaddleOCR/tar.gz/refs/tags/v2.9.1` | `doc/doc_ch/algorithm_det_db.md` (DB/DB++ paper and metrics), `algorithm_rec_crnn.md`, `ppocr/utils/ppocr_keys_v1.txt` (6,623-character dictionary) |
| RapidOCR (pure-inference PaddleOCR) | `https://codeload.github.com/RapidAI/RapidOCR/tar.gz/refs/heads/main` | `ch_ppocr_det/utils.py` (`DBPostProcess`), `ch_ppocr_rec/utils.py` (`CTCLabelDecode`), `utils/process_img.py` (perspective crop), `config.yaml` (thresholds) |
| PP-OCRv4 ONNX weights | `https://www.modelscope.cn/models/RapidAI/RapidOCR` | `det/ch_PP-OCRv4_det_mobile.onnx`, `rec/ch_PP-OCRv4_rec_mobile.onnx`, `rec/en_PP-OCRv4_rec_mobile.onnx` |

The re-implementation in this repo lives in `src/main/ocr/{image,det,rec,index}.js`.

## 3. How it works

### 3.1 Detection: DB (Differentiable Binarization, AAAI 2020)

The classical approach is "probability map → fixed threshold → binary mask": the threshold is not
learnable and the post-processing is brittle. DB makes the network predict **both** a probability map `P`
and a threshold map `T`, and binarises differentiably:

```
B(i,j) = 1 / (1 + e^(-k * (P(i,j) - T(i,j))))     # k = 50
```

`B` approximates a step function but stays differentiable, so the binarisation itself is trained. At
inference only `P` is needed (threshold 0.3); `T` and `B` exist for training supervision
(`loss = L1(P, mask) + L1(B, label) + L1(T, label)`).

Training labels shrink each polygon by an offset `D` to obtain the kernel (Vatti clipping):

```
D = A * (1 - r^2) / L        # A area, L perimeter, r shrink ratio (0.4)
```

That is exactly why **post-processing "unclips" with the same formula in reverse** — the network learned
the shrunk kernel, so it has to be expanded back by the same ratio.

**Post-processing (this is what `det.js` implements)**:

1. `P > 0.3` → binary mask → 2×2 dilation (reconnects parts broken by strokes);
2. 8-connected components → convex hull → **minimum-area rectangle (rotating calipers)**; drop boxes whose
   short side is < 3px;
3. mean probability inside the box = confidence; drop below 0.5;
4. **unclip**: `d = area × 1.6 / perimeter`, expand the rectangle by `d` on both axes (equivalent to
   pyclipper's round offset followed by a minimum-area rectangle);
5. map back to image coordinates → order corners as (tl, tr, br, bl) → drop boxes ≤ 3px in either side;
6. reading order: sort by `y`, a gap of ≥ 10px starts a new line, sort by `x` within a line.

### 3.2 Recognition: CRNN/SVTR + CTC

- Resize to height 48, width = the batch's largest aspect ratio (PaddleOCR's `max(320/48, batch ratio)`),
  zero-padded on the right;
- Normalise `(x/255 - 0.5)/0.5`, CHW layout;
- The network outputs `[N, T, C]` with `C = blank + 6,623 dictionary characters + space`;
- **CTC greedy decode**: argmax per time step → collapse repeats → drop blank(0) → map through the
  dictionary; confidence is the mean probability of the kept characters.

The point of CTC is that it needs no character-level alignment: repeated characters are separated by a
blank, and the network learns by itself when to emit and when to stay silent.

## 4. What we wrote (not a wrapper around an existing tool)

| File | Lines | Contents |
| --- | --- | --- |
| `src/main/ocr/image.js` | 183 | RGBA→RGB, bilinear resize, **4-point homography solve (8×8 Gaussian elimination) + inverse-mapped perspective sampling**, 90° rotation |
| `src/main/ocr/det.js` | 346 | DB preprocessing/normalisation/CHW, **connected components, convex hull, rotating-calipers minimum rectangle, in-polygon mean probability, unclip expansion, clockwise ordering, reading order** |
| `src/main/ocr/rec.js` | 142 | Recognition preprocessing (aspect-preserving resize / zero pad / normalise), batching, **CTC greedy decode + dictionary mapping** |
| `src/main/ocr/index.js` | 107 | Pipeline: detect → perspective crop → batch by aspect ratio → restore reading order |
| `src/renderer/js/ocr.js` | 349 | UI: whole-page / region recognition, result panel, box overlay, copy, insert as text box |

The **only third-party component** is `onnxruntime-node` — a generic tensor runtime (the equivalent of
BLAS) with no OCR logic in it. All preprocessing, post-processing, decoding and layout ordering is our own
JavaScript.

### 4.1 Chinese and English

| Mode | Model | Dictionary | Use case |
| --- | --- | --- | --- |
| Auto (default) | Try the Chinese model on the first 6 lines; switch to English when there is no Han character and ≥ 12 Latin letters | — | Unknown document language |
| Chinese + English | `ch_PP-OCRv4_rec_mobile` | ppocr_keys_v1 (6,623 chars) | Chinese, mixed Chinese/English |
| English only | `en_PP-OCRv4_rec_mobile` | en_dict (95 chars) | English papers and forms; better with spaces and punctuation |

On the same English image: the Chinese model returns
`Answer -Nitrificationby nitrifyingbacteria` (spaces lost), the English model returns
`Answer - Nitrification by nitrifying bacteria` — correct, confidence 0.981 → 0.993.

## 5. Measured results (local CPU, inside the Electron main process)

| Case | Result |
| --- | --- |
| 900×360, three lines, mixed Chinese/English | 3/3 lines correct, 330 ms (det 221 / rec 109) |
| 1400×1400, thirteen lines, mixed | 13/13 lines correct, 1.3 s (det 412 / rec 897) |
| A4 scan 1190×1684 (rendered at 1.6×) | 14 lines, 1.5–1.9 s (det ~450 / rec ~1.2 s) |
| Selected region (one strip mid-page) | 4 lines, 648 ms |
| Blank image | 0 boxes, 304 ms (no false positives) |
| Three English lines (auto → English model) | 3/3 lines correct with spaces, 616 ms |
| Three Chinese lines (auto → Chinese model) | 3/3 lines correct, 313 ms |

Known limits: at very small type (< 10px) visually similar characters can be confused (one case of
氮 → 氨 in testing), and runs of spaces can collapse in dense layouts.
