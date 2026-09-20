#!/usr/bin/env node
/**
 * Smoke the snapshotted --json-only dump. No live Verilator.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tree = JSON.parse(
  readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.tree.json"), "utf8"),
);
const meta = JSON.parse(
  readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.meta.json"), "utf8"),
);
const manifest = JSON.parse(
  readFileSync(resolve(root, "fixtures/svb_afifo/manifest.json"), "utf8"),
);

function fail(msg) {
  console.error(`fixture check failed: ${msg}`);
  process.exit(1);
}

function walk(node, visit) {
  if (node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      walk(child, visit);
    }
    return;
  }
  if (typeof node.type === "string") {
    visit(node);
  }
  for (const value of Object.values(node)) {
    walk(value, visit);
  }
}

const modules = new Set();
const cells = [];
const keywords = new Map();
const genNames = new Set();
let primaryIo = 0;
let topPorts = 0;

walk(tree, (node) => {
  if (node.type === "MODULE" && typeof node.name === "string") {
    modules.add(node.name);
  }
  if (node.type === "CELL") {
    cells.push(node);
  }
  if (node.type === "ALWAYS" && typeof node.keyword === "string") {
    keywords.set(node.keyword, (keywords.get(node.keyword) ?? 0) + 1);
  }
  if (node.type === "GENBLOCK" && typeof node.name === "string") {
    genNames.add(node.name);
  }
  if (node.type === "VAR") {
    if (node.isPrimaryIO === true) {
      primaryIo += 1;
    }
    if (node.varType === "PORT") {
      topPorts += 1;
    }
  }
});

if (!modules.has("svb_afifo") || !modules.has("svb_sync")) {
  fail(`expected MODULE svb_afifo and svb_sync, got ${[...modules].join(",")}`);
}
if (primaryIo !== 12) {
  fail(`expected 12 top-module isPrimaryIO ports, got ${primaryIo}`);
}
if (topPorts < 16) {
  fail(`expected at least 16 varType=PORT (including svb_sync), got ${topPorts}`);
}
if (cells.length !== 10) {
  fail(`expected 10 CELL, got ${cells.length}`);
}
if (!genNames.has("gen_pointer_sync[4]")) {
  fail(`missing gen_pointer_sync[4]; have ${[...genNames].join(",")}`);
}
if ((keywords.get("always_ff") ?? 0) < 1 || (keywords.get("always_comb") ?? 0) < 1) {
  fail(`unexpected ALWAYS.keyword counts: ${JSON.stringify([...keywords])}`);
}
if (manifest.top !== "svb_afifo" || manifest.verilator !== "5.046") {
  fail(`manifest mismatch: ${JSON.stringify(manifest)}`);
}
const fileCount = meta.files && typeof meta.files === "object" ? Object.keys(meta.files).length : 0;
if (fileCount < 2) {
  fail("meta.files missing");
}

console.log(
  `ok: modules=${[...modules].join(",")} isPrimaryIO=${primaryIo} CELL=${cells.length} ALWAYS=${JSON.stringify(Object.fromEntries(keywords))}`,
);
