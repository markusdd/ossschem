import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

/* A generated viewer directory is opened straight off disk, and a file:// page
 * may not fetch anything CORS-gated: a module script, or any subresource
 * carrying crossorigin, is refused and the page stays blank. Emitting one
 * classic script and dropping the attribute keeps the output loadable from
 * both file:// and a server. */
function openableFromDisk() {
  return {
    name: "openable-from-disk",
    // build only: the dev server serves real modules and must keep them
    apply: "build",
    transformIndexHtml(html) {
      return html
        .replace(/\s+crossorigin(=(["'])[^"']*\2)?/g, "")
        // a module script is deferred implicitly, a classic one is not, so it
        // has to say so or it runs before the root element exists
        .replace(/<script\s+type="module"\s+src=/g, "<script defer src=");
    },
  };
}

export default defineConfig({
  // Keep production asset URLs relative so generated viewer directories can be opened directly.
  base: "./",
  plugins: [react(), openableFromDisk()],
  build: {
    // a classic script, in one piece: module scripts cannot load from file://
    modulePreload: false,
    rollupOptions: {
      output: { format: "iife", inlineDynamicImports: true },
    },
  },
  publicDir: resolve(import.meta.dirname, "../../fixtures/svb_afifo/golden"),
  server: {
    port: 5173,
  },
});
