import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { viewerHtml } from "../src/webview-html.js";

const VIEWER = resolve(import.meta.dirname, "../../../packages/cli/viewer/index.html");

function build(overrides: Partial<Parameters<typeof viewerHtml>[0]> = {}): string {
  return viewerHtml({
    indexHtml: readFileSync(VIEWER, "utf8"),
    baseUri: "https://file+.vscode-resource.example/viewer",
    cspSource: "https://file+.vscode-resource.example",
    nonce: "TESTNONCE",
    design: { top: "m0", modules: {} },
    sources: { "a.sv": "module a; endmodule" },
    ...overrides,
  });
}

describe("webview page", () => {
  it("resolves the bundle's own asset URLs against the viewer directory", () => {
    // without this the relative URLs the bundle builds point at the webview
    // document, where the files are not
    expect(build()).toContain('<base href="https://file+.vscode-resource.example/viewer/">');
  });

  it("gives every script the nonce the policy allows", () => {
    const html = build();
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(1);
    for (const tag of scripts) {
      expect(tag).toContain('nonce="TESTNONCE"');
    }
    expect(html).toContain("script-src 'nonce-TESTNONCE'");
  });

  it("denies everything the viewer does not need", () => {
    expect(build()).toContain("default-src 'none'");
  });

  it("hands the design and the sources to the bundle the way the page does", () => {
    const html = build();
    expect(html).toContain('window.__OSSSCHEM_DESIGN__={"top":"m0","modules":{}}');
    expect(html).toContain('window.__OSSSCHEM_SOURCES__=');
    expect(html).toContain("module a; endmodule");
  });

  it("escapes a closing tag hiding in the data", () => {
    const html = build({ sources: { "x.sv": "</script><script>alert(1)</script>" } });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script");
  });
});
