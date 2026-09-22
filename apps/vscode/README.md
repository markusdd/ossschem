# ossschem VS Code extension

Opens a schematic inside VS Code. The webview runs the same bundle the
standalone page runs, handed the design and the source text on `window`, so
there is one viewer rather than two.

Not published to the Marketplace; install the `.vsix`, or run it from the
checkout.

## Install it

    npm install && npm run package:vsix      # in the repo root

Writes `apps/vscode/ossschem-vscode-<version>.vsix`, viewer bundle included.
Install it with **Extensions: Install from VSIX…** in the command palette, or
`code --install-extension apps/vscode/ossschem-vscode-<version>.vsix`. VS Code
only replaces an extension with a higher version, so pass a new one when
rebuilding: `npm run package:vsix -- 0.2.0`.

## Run it from the checkout

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
signal in the waveform viewer and in its netlist tree. It opens the instances
between the current scope and that signal in place, highlights it and frames
it, with its declaration, drivers and loads in the source pane -- the scope on
screen does not change, so the answer arrives in the context the question was
asked in. Both directions are deliberate: scrubbing the cursor moves the
waveform selection around, and a schematic that followed it would not stay
still long enough to read.

With no waveform open there is nowhere to add a signal, and the extension says
so and offers to open one.

One dump serves everything -- adding signals, values at the cursor, the
diagnostic -- rather than values being read from one and signals added to
another. Which one it is, is named by the **Waveform** picker at the top of the
schematic's sidebar, and changed there. It is settled once, from the dump on
screen when there are several, and then left alone: a target that followed the
focus would move under the user between one operation and the next. Closing
that dump settles it again.

**Values** in the toolbar labels each wire with its value at the waveform
cursor, following the cursor as it moves. The schematic asks only about the
nets it is currently showing, so the extension needs to know nothing about the
view. An unpacked array has no single value, so the wire into its splitter
carries none, but each branch off it is one element and does. Values are
written as Verilog writes them (`1'b1`, `8'h0f`), with unknown bits kept in
binary (`4'b010x`), and a signal that changes at the cursor shows the step
across it (`8'h0f→a3`). The value of the selected signal lights up with it,
and is written out on the heading of the source pane.

`ossschem: Show log` traces every step. `ossschem: Diagnose waveform probing`
reports what vaporview knows about the last signal picked, which is the first
thing to check when something does not appear.
