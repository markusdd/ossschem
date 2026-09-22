import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Design } from "@ossschem/ir";
import { ingestFiles } from "@ossschem/ingest-verilator";
import { serializeDesign } from "@ossschem/ir";

export const packageName = "@ossschem/cli" as const;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const sourceExtensions = new Set([".sv", ".svh", ".v", ".vh"]);

/* The oldest Verilator this has been tested against. What it reads is the
 * --json-only AST, whose shape and node names move between releases, so an
 * older one is worth saying out loud rather than leaving to fail obscurely. */
export const MIN_VERILATOR = "5.046";

/** The version out of `verilator --version`: "Verilator 5.050 2026-07-01 rev v5.050". */
export function parseVerilatorVersion(text: string): string | undefined {
  return /Verilator\s+(\d+\.\d+(?:\.\d+)?)/.exec(text)?.[1];
}

export function verilatorOlderThan(version: string, minimum = MIN_VERILATOR): boolean {
  const parts = (text: string): number[] => text.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [have, want] = [parts(version), parts(minimum)];
  for (let i = 0; i < Math.max(have.length, want.length); i++) {
    const a = have[i] ?? 0;
    const b = want[i] ?? 0;
    if (a !== b) {
      return a < b;
    }
  }
  return false;
}

/** What the Verilator on PATH says it is, recorded in the IR next to the design. */
function detectVerilatorVersion(command: string): string | undefined {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return result.error ? undefined : parseVerilatorVersion(`${result.stdout ?? ""} ${result.stderr ?? ""}`);
}

function printHelp(): void {
  process.stdout.write(`ossschem — interactive RTL schematic tracer

Commands:
  ossschem dump [--top name] [--out file] [--verilator-version ver] <tree.json> <meta.json>
  ossschem dump --fixture svb_afifo
  ossschem build --top name [--out-dir dir] [--verilator path] [--open] <source.sv> [...]
  ossschem open <viewer-dir-or-index.html>

build runs Verilator --json-only, writes schematic-ir.json, copies the browser viewer,
embeds the design and source files in index.html, and optionally opens that file.
Use --sources dir more than once when source files are outside the Verilator command line.

Needs Verilator ${MIN_VERILATOR} or newer; its version is detected and recorded in the IR.
`);
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i < 0 || i + 1 >= argv.length ? undefined : argv[i + 1];
}

function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag);
}

function positionalArgs(argv: readonly string[], valueFlags: ReadonlySet<string>): string[] {
  const values: string[] = [];
  let consumeValue = false;
  for (const arg of argv) {
    if (consumeValue) {
      consumeValue = false;
      continue;
    }
    if (arg === "--") continue;
    if (arg.startsWith("--")) {
      consumeValue = valueFlags.has(arg);
      continue;
    }
    values.push(arg);
  }
  return values;
}

function resolvePath(path: string): string {
  return resolve(process.cwd(), path);
}

function loadDesign(treePath: string, metaPath: string, top: string | undefined, verilatorVersion: string): Design {
  return ingestFiles(resolvePath(treePath), resolvePath(metaPath), {
    verilatorVersion,
    dumpedAt: new Date().toISOString(),
    topName: top,
  });
}

function collectSourceFile(path: string, sources: Record<string, string>): void {
  if (!existsSync(path) || !statSync(path).isFile()) return;
  const name = basename(path);
  if (sources[name] === undefined) sources[name] = readFileSync(path, "utf8");
}

function collectSourceRoot(root: string, sources: Record<string, string>): void {
  if (!existsSync(root)) return;
  const info = statSync(root);
  if (info.isFile()) {
    collectSourceFile(root, sources);
    return;
  }
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    if (statSync(path).isDirectory()) collectSourceRoot(path, sources);
    else if (sourceExtensions.has(extname(path).toLowerCase())) collectSourceFile(path, sources);
  }
}

function collectSources(design: Design, explicitRoots: readonly string[]): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const file of Object.values(design.files)) {
    if (!file.path.startsWith("<")) collectSourceFile(resolvePath(file.path), sources);
  }
  for (const root of explicitRoots) collectSourceRoot(resolvePath(root), sources);
  return sources;
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function ensureViewerDist(): string {
  const bundled = resolve(packageRoot, "viewer");
  if (existsSync(resolve(bundled, "index.html"))) return bundled;
  const dist = resolve(repoRoot, "apps/web/dist");
  if (!existsSync(resolve(dist, "index.html"))) {
    const result = spawnSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
    if (result.status !== 0) throw new Error("unable to build the ossschem web viewer");
  }
  if (!existsSync(resolve(dist, "index.html"))) throw new Error(`viewer build not found at ${dist}`);
  return dist;
}

function writeViewer(outDir: string, design: Design, sources: Record<string, string>): string {
  const viewerDist = ensureViewerDist();
  mkdirSync(outDir, { recursive: true });
  cpSync(viewerDist, outDir, { recursive: true });
  writeFileSync(resolve(outDir, "schematic-ir.json"), serializeDesign(design));
  writeFileSync(resolve(outDir, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`);
  const indexPath = resolve(outDir, "index.html");
  const index = readFileSync(indexPath, "utf8");
  const bootstrap = `<script>window.__OSSSCHEM_DESIGN__=${jsonForScript(design)};window.__OSSSCHEM_SOURCES__=${jsonForScript(sources)};</script>`;
  writeFileSync(indexPath, index.replace("</head>", `${bootstrap}</head>`));
  return indexPath;
}

function openBrowser(path: string): void {
  const url = pathToFileURL(path).href;
  const configured = process.env.BROWSER;
  if (configured !== undefined && configured.trim() !== "") {
    const child = spawn(configured, [url], { detached: true, stdio: "ignore" });
    child.unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function dump(argv: readonly string[]): number {
  const fixture = argValue(argv, "--fixture");
  if (fixture !== undefined) {
    const dir = resolve(repoRoot, "fixtures", fixture);
    const manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8")) as { verilator: string; top: string };
    const design = loadDesign(
      resolve(dir, "verilator", `${manifest.top}.tree.json`),
      resolve(dir, "verilator", `${manifest.top}.meta.json`),
      manifest.top,
      manifest.verilator,
    );
    const out = resolve(dir, "golden", "schematic-ir.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, serializeDesign(design));
    process.stdout.write(`${out}\n`);
    return 0;
  }
  const positional = positionalArgs(argv, new Set(["--top", "--out", "--verilator-version"]));
  if (positional.length < 2) {
    printHelp();
    return 1;
  }
  const out = resolvePath(argValue(argv, "--out") ?? "schematic-ir.json");
  mkdirSync(dirname(out), { recursive: true });
  const design = loadDesign(positional[0], positional[1], argValue(argv, "--top"), argValue(argv, "--verilator-version") ?? "unknown");
  writeFileSync(out, serializeDesign(design));
  process.stdout.write(`${out}\n`);
  return 0;
}

function build(argv: readonly string[]): number {
  const valueFlags = new Set(["--top", "--out-dir", "--verilator", "--verilator-version", "--sources"]);
  const positional = positionalArgs(argv, valueFlags);
  const top = argValue(argv, "--top");
  if (top === undefined || positional.length === 0) {
    printHelp();
    return 1;
  }
  const outDir = resolvePath(argValue(argv, "--out-dir") ?? "ossschem-build");
  const verilator = argValue(argv, "--verilator") ?? "verilator";
  const detected = detectVerilatorVersion(verilator);
  const version = argValue(argv, "--verilator-version") ?? detected ?? "unknown";
  if (detected !== undefined && verilatorOlderThan(detected)) {
    process.stderr.write(`ossschem: Verilator ${detected} is older than ${MIN_VERILATOR}, the oldest tested;`
      + " the JSON it writes may not read correctly\n");
  }
  const tempDir = resolve(outDir, ".verilator");
  mkdirSync(tempDir, { recursive: true });
  const tree = resolve(tempDir, `${top}.tree.json`);
  const meta = resolve(tempDir, `${top}.meta.json`);
  const verilatorArgs = [
    "--json-only", "--no-json-edit-nums", "--top-module", top,
    "--json-only-output", tree, "--json-only-meta-output", meta,
    ...positional.map(resolvePath),
  ];
  const result = spawnSync(verilator, verilatorArgs, { cwd: process.cwd(), stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return 1;
  }
  if (result.status !== 0) return result.status ?? 1;
  const design = loadDesign(tree, meta, top, version);
  const explicitSources = argv.flatMap((arg, i) => arg === "--sources" && i + 1 < argv.length ? [argv[i + 1]] : []);
  const indexPath = writeViewer(outDir, design, collectSources(design, explicitSources));
  process.stdout.write(`${indexPath}\n`);
  if (hasFlag(argv, "--open")) openBrowser(indexPath);
  return 0;
}

function open(argv: readonly string[]): number {
  const target = positionalArgs(argv, new Set())[0];
  if (target === undefined) {
    printHelp();
    return 1;
  }
  const path = resolvePath(target);
  const index = existsSync(path) && statSync(path).isDirectory() ? resolve(path, "index.html") : path;
  if (!existsSync(index)) {
    process.stderr.write(`viewer index not found: ${index}\n`);
    return 1;
  }
  openBrowser(index);
  process.stdout.write(`${index}\n`);
  return 0;
}

export function main(argv: readonly string[]): number {
  const args = [...argv];
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return args.length === 0 ? 1 : 0;
  }
  if (args[0] === "dump") return dump(args.slice(1));
  if (args[0] === "build") return build(args.slice(1));
  if (args[0] === "open") return open(args.slice(1));
  process.stderr.write(`unknown command: ${args[0]}\n`);
  printHelp();
  return 1;
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry !== undefined && (entry.endsWith("/cli/src/main.ts") || entry.endsWith("/cli/dist/main.js"))) {
  process.exitCode = main(process.argv.slice(2));
}
