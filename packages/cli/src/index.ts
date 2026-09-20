#!/usr/bin/env node

export { main, packageName } from "./main.js";
import { main as run } from "./main.js";

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry !== undefined && (entry.endsWith("/cli/src/index.ts") || entry.endsWith("/cli/dist/index.js") || entry.endsWith("/ossschem"))) {
  process.exitCode = run(process.argv.slice(2));
}
