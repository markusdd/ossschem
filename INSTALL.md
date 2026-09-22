# Installing and building ossschem

Two things ship: the `ossschem` command, which turns RTL into a schematic, and
the VS Code extension, which opens one inside the editor. Both are optional
alone — the command writes a page that any browser opens.

Verilator is the one system dependency: it is what reads the RTL. **5.046 or
newer** — that is the oldest release `--json-only` has been tested against, and
the AST it writes changes shape between releases. `ossschem build` runs
`verilator --version`, records it in the IR beside the design, and warns when
it is older. Tested against 5.046 and 5.050.

## Install the command

A release is a self-contained tarball — the command, the viewer it writes, and
a Node runtime. No npm, no `node_modules`, nothing to resolve.

```bash
tar -xzf ossschem-<version>-linux-x64.tar.gz -C /opt
ln -s /opt/ossschem-<version>-linux-x64/bin/ossschem ~/.local/bin/ossschem
ossschem --help
```

The tree is relocatable and the launcher resolves its own directory through
symlinks, so it can be moved, shared read-only, or mounted on a build machine.
A build without the bundled runtime (`-nodeless`) is about 2 MB and uses `node`
from `PATH` instead.

## Install the VS Code extension

Install `ossschem-vscode-<version>.vsix` with **Extensions: Install from
VSIX…** in the command palette, or:

```bash
code --install-extension ossschem-vscode-<version>.vsix
```

The viewer is inside the `.vsix`; the extension needs nothing else. VS Code
replaces an extension only with a higher version, so rebuild with a new one.

## Build from a checkout

```bash
npm install
npm run build        # the viewer bundle, which the CLI and the extension serve
npm test             # typecheck, fixture check, unit tests
npm run dev          # Vite app at http://localhost:5173
npm run ossschem -- build --top my_top --out-dir build/schematic rtl/*.sv
```

Requires Node 20+. `npm run fixture:dump` regenerates the Verilator
`--json-only` input for the golden fixture, which is pinned to Verilator 5.046;
`npm run ossschem -- dump --fixture svb_afifo` rebuilds the golden IR from it.
CI never runs Verilator, it uses the checked-in `fixtures/svb_afifo/verilator/`.

To run the extension without packaging it: `npm run build`, open the repo in VS
Code and press **F5** ("Run ossschem extension"). The extension loads the
viewer from `packages/cli/viewer` when it is not bundled beside itself.

## Package a release

```bash
npm run package:dist                             # host platform, runtime included
npm run package:dist -- --platform linux-arm64   # also darwin-x64, darwin-arm64
npm run package:dist -- --no-runtime             # ~2 MB; uses node from PATH
npm run package:dist -- --version 1.2.3          # names the tarball
```

Writes `dist/ossschem-<version>-<platform>.tar.gz`. The CLI is bundled into one
ESM file with every dependency inlined, the viewer is copied beside it, and the
launcher prefers `runtime/bin/node` over anything on `PATH`. The first run
downloads the pinned Node release from nodejs.org and verifies it against the
published SHA-256; later runs reuse `dist/.cache`. With the runtime that is
about 45 MB packed and 120 MB unpacked, nearly all of it the interpreter.
Windows is not packaged.

```bash
npm run package:vsix                             # apps/vscode/ossschem-vscode-<version>.vsix
npm run package:vsix -- 0.2.0                    # bump the version while packaging
```

Both commands build the viewer first, so a package always carries a current
one.

## How the webview page is built

`apps/vscode/src/webview-html.ts` is free of the VS Code API so it can be
tested directly (`apps/vscode/test`). It takes the viewer's `index.html` and
adds:

- a `<base href>` pointing at the viewer directory — the bundle builds asset
  URLs relative to the document, which in a webview is not where the files are;
- a Content-Security-Policy that denies everything by default and allows the
  scripts by nonce;
- the design and sources, escaped for embedding in a script tag.
