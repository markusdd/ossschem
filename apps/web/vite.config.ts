import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  publicDir: resolve(import.meta.dirname, "../../fixtures/svb_afifo/golden"),
  server: {
    port: 5173,
  },
});
