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

## Cross probing

Select a signal in the schematic and press `W`, or use the **Waveform** button,
to add it to vaporview. The extension resolves the name against the open dump
before adding: `addVariable` accepts a name it cannot find without complaining,
so an unverified spelling looks exactly like success.

Names come from the same elaboration as the dump, so they line up. Unpacked
arrays are the exception worth knowing: a dump gives the array a scope of its
own and names each element by index alone, so `wen_s[0]` is
`tb.wen_s.[0]`. Selecting an array asks which elements to add -- whole for a
small bundle, the first element for anything larger, or an index, range
(`0-7`) or list (`0,2,5`) typed into the picker.

The reverse direction is **Reveal in schematic**, on the right click menu of a
signal in the waveform viewer and in its netlist tree. It switches the
schematic to the module that signal lives in and highlights it, with its
declaration, drivers and loads in the source pane. Both directions are
deliberate: scrubbing the cursor moves the waveform selection around, and a
schematic that followed it would not stay still long enough to read.

**Values** in the toolbar labels each wire with its value at the waveform
cursor, following the cursor as it moves. The schematic asks only about the
nets it is currently showing, so the extension needs to know nothing about the
view. Unpacked arrays are left out: the array as a whole has no single value.
Values are written as Verilog writes them (`1'b1`, `8'h0f`), with unknown bits
kept in binary (`4'b010x`), and a signal that changes at the cursor shows the
step across it (`8'h0f→a3`).

`ossschem: Show log` traces every step. `ossschem: Diagnose waveform probing`
reports what vaporview knows about the last signal picked, which is the first
thing to check when something does not appear.
