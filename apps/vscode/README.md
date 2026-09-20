# ossschem VS Code extension

Skeleton (PR 17). Command **ossschem: Open schematic** is meant to run on an `.ir.json` file produced by `ossschem dump`. The webview will host `@ossschem/ui` (same package as the Vite app). Elk worker must be loaded with `asWebviewUri` and `worker-src` in the CSP.

Not published to the Marketplace.
