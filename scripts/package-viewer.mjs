#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = resolve(root, "apps/web/dist");
const destination = resolve(root, "packages/cli/viewer");

if (!existsSync(resolve(source, "index.html"))) {
  console.error(`viewer build not found at ${source}; run npm run build -w @ossschem/web first`);
  process.exit(1);
}

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log(`packaged viewer at ${destination}`);
