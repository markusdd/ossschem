# ossschem VS Code extension

Opens a schematic inside VS Code. The webview runs the same bundle the
standalone page runs, handed the design and the source text on `window`, so
there is one viewer rather than two.

Not published to the Marketplace; run it locally.

## Run it

1. `npm install && npm run build` in the repo root — the extension loads the
   viewer from `packages/cli/viewer`, which `build` produces.
2. Open the repo in VS Code and press **F5** ("Run ossschem extension"). A
   second window opens with the extension loaded.
3. In that window, open a design's schematic directory and run **ossschem: Open
   schematic** on `schematic-ir.json`, or right-click the file in the explorer.

Produce the input with `ossschem build --top <top> --out-dir <dir> <sources>`;
it writes `schematic-ir.json` and `sources.json`, and the extension reads both.

## How the page is built

`src/webview-html.ts` is free of the VS Code API so it can be tested directly
(`apps/vscode/test`). It takes the viewer's `index.html` and adds:

- a `<base href>` pointing at the viewer directory — the bundle builds asset
  URLs relative to the document, which in a webview is not where the files are;
- a Content-Security-Policy that denies everything by default and allows the
  scripts by nonce;
- the design and sources, escaped for embedding in a script tag.
