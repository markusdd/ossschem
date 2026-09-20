import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Keep production asset URLs relative so generated viewer directories can be opened directly.
  base: "./",
  plugins: [react()],
  publicDir: resolve(import.meta.dirname, "../../fixtures/svb_afifo/golden"),
  server: {
    port: 5173,
  },
});
