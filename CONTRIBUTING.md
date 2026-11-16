# Contributing

Thanks for wanting to improve this project. It is an exercise in "clean UI, serious features", so we
care just as much about **clean code** as about **features that actually work**.

## 1. Setup

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 18 (20 / 22 recommended) | Build and run |
| npm | ≥ 9 | Package manager |
| Windows | 10 / 11 x64 | Only Windows installers are published; the core code is cross-platform |

```bash
git clone https://github.com/pinzhuo0905-rgb/pdf-reader.git
cd pdf-reader
npm install          # runs postinstall → scripts/prepare-vendor.mjs
npm start            # start in development mode
npm run dist         # build the Windows installer into dist/
```

`npm install` copies the browser builds of `pdfjs-dist` / `pdf-lib` / `fontkit` into
`src/renderer/vendor/` (that directory is not committed). If it fails, run it by hand:

```bash
node scripts/prepare-vendor.mjs
```

## 2. Layout

```
src/
├── main/                  # main process (Node side)
│   ├── main.js            # windows, menus, IPC, custom app:// protocol, printing
│   ├── preload.js         # the restricted API exposed through contextBridge
│   └── ocr/               # the OCR engine (a pure-JS pipeline)
│       ├── image.js       # bilinear resize, homography, perspective sampling
│       ├── det.js         # DB detection post-processing: components/hull/min-rect/unclip
│       ├── rec.js         # recognition preprocessing + CTC greedy decode
│       └── index.js       # pipeline, Chinese/English model switching
└── renderer/              # renderer (no framework, plain DOM)
    ├── index.html         # toolbar / panels / overlays
    ├── css/app.css        # all styles (including the dark theme variables)
    └── js/
        ├── icons.js       # inline SVG icon set
        ├── state.js       # global state + undo/redo snapshots
        ├── viewer.js      # rendering, zoom, lazy loading, text layer, search, page ops
        ├── annotate.js    # annotation drawing / hit testing / pointer interaction
        ├── textedit.js    # in-place text editing (sample background → cover → re-typeset)
        ├── exporter.js    # writes annotations and page ops back into the PDF with pdf-lib
        ├── ocr.js         # OCR panel
        ├── ui.js          # toolbar, menus, shortcuts, save/print
        └── app.js         # bootstrap
```

**Conventions**: the renderer uses no bundler and no front-end framework. Scripts load in classic
`<script>` order and talk through the global `App` namespace (`App.viewer` / `App.annotate` / `App.ocr` /
`App.ui` / `App.state`). When you add a file, update the script order in `index.html`.

## 3. Code style

- 2-space indent, single quotes, semicolons — match the surrounding file;
- Make sure `node --check <file>` passes before committing (there is no ESLint config; zero syntax errors
  is the bar);
- Comments should explain **why**, not **what**; public APIs get JSDoc;
- Do not introduce a front-end framework or a bundler — "zero build, open and read" is one of the points
  of this project;
- Justify any new dependency: if 100 lines of code solve it, do not pull in a 10 MB library.

## 4. Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
feat(ocr): recognise a selected region
fix(viewer): annotation coordinates were offset on rotated pages
docs(readme): add the shortcut table
refactor(exporter): split the coordinate transforms out
perf(det): use an Int32 stack for connected components, 18% faster full-page detection
```

## 5. Branches and pull requests

1. Branch from `main`: `feat/xxx`, `fix/xxx`, `docs/xxx`;
2. One PR does one thing; the title says **what changed and why**;
3. Include **how you verified it** in the description (screenshot, self-check output, or manual steps);
4. UI changes need before/after screenshots — and check the dark theme too;
5. Changes that affect PDF output must state whether existing documents stay compatible.

## 6. Self-check scripts

The repo ships a headless end-to-end harness (no window is shown; it exits by itself) for quick
regressions after a change:

```bash
# interaction: highlight / pen / text box / eraser / undo / rotate
PDFREADER_TEST=test/e2e/interact.js npx electron . test/fixtures/sample.pdf

# OCR: whole page + insert as text box + export PDF
PDFREADER_TEST=test/e2e/ocr.js npx electron . test/fixtures/sample.pdf

# tabs: open/dedupe/reorder/tear out/close/state isolation + contents sidebar
PDFREADER_TEST=test/e2e/tabs.js npx electron . test/fixtures/sample.pdf

# or use the wrappers (they set the delay and the exit code)
npm run test:interact
npm run test:ocr
npm run test:tabs

# screenshot (writes the file, then exits)
PDFREADER_SHOT=shot.png npx electron . test/fixtures/sample.pdf
```

> In cmd / PowerShell, `PDFREADER_TEST=... npx electron` becomes `set PDFREADER_TEST=...` or
> `$env:PDFREADER_TEST="..."`.

## 7. What not to commit

- `node_modules/`, `dist/`, `src/renderer/vendor/` (all generated by scripts)
- Any personal document or PDF containing private content
- New third-party model weights (> 10 MB): open an issue first, so the repository does not balloon

## 8. License

By submitting code you agree to distribute your contribution under the [MIT](./LICENSE) license.
