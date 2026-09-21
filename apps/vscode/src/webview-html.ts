/**
 * The page the extension puts in a webview.
 *
 * Kept free of the vscode API so it can be exercised directly: everything the
 * host knows -- where the assets are reachable from, what the policy allows --
 * arrives as plain strings.
 */
export interface ViewerPage {
  /** index.html as the viewer build wrote it. */
  indexHtml: string;
  /** Where the viewer directory is reachable from, without a trailing slash. */
  baseUri: string;
  /** Origin the host allows passive resources from. */
  cspSource: string;
  nonce: string;
  design: unknown;
  sources: Record<string, string>;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function viewerHtml(page: ViewerPage): string {
  const csp = [
    "default-src 'none'",
    `img-src ${page.cspSource} data:`,
    `font-src ${page.cspSource}`,
    // the bundle injects its stylesheet at runtime
    `style-src ${page.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${page.nonce}'`,
  ].join("; ");
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    // the bundle builds asset URLs relative to the document, which in a
    // webview is not where the files are
    `<base href="${page.baseUri}/">`,
    `<script nonce="${page.nonce}">` +
      `window.__OSSSCHEM_DESIGN__=${jsonForScript(page.design)};` +
      `window.__OSSSCHEM_SOURCES__=${jsonForScript(page.sources)};</script>`,
  ].join("");
  return page.indexHtml
    .replace("<head>", `<head>${head}`)
    // every script has to carry the nonce, including the one just added
    .replace(/<script(?! nonce=)/g, `<script nonce="${page.nonce}"`);
}
