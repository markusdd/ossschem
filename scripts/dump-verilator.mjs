#!/usr/bin/env node
/**
 * Regenerate fixtures/svb_afifo/verilator/*.json from the vendored SV.
 * Requires Verilator on PATH (5.046 locally). CI does not run this.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root, "fixtures/svb_afifo");
const treeOut = resolve(fixture, "verilator/svb_afifo.tree.json");
const metaOut = resolve(fixture, "verilator/svb_afifo.meta.json");

mkdirSync(dirname(treeOut), { recursive: true });

const argv = [
  "--json-only",
  "--no-json-edit-nums",
  "--top-module",
  "svb_afifo",
  "--json-only-output",
  treeOut,
  "--json-only-meta-output",
  metaOut,
  resolve(fixture, "src/svb_sync.sv"),
  resolve(fixture, "src/svb_afifo.sv"),
];

const result = spawnSync("verilator", argv, { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
