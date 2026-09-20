import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestFiles } from "@ossschem/ingest-verilator";
import { serializeDesign } from "@ossschem/ir";

export const packageName = "@ossschem/cli" as const;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function printHelp(): void {
  process.stdout.write(`ossschem dump — Verilator --json-only tree+meta → Schematic IR

Usage:
  ossschem dump [--top name] [--out file] [--verilator-version ver] <tree.json> <meta.json>
  ossschem dump --fixture svb_afifo
`);
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) {
    return undefined;
  }
  return argv[i + 1];
}

export function main(argv: readonly string[]): number {
  const args = [...argv];
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return args.length === 0 ? 1 : 0;
  }
  if (args[0] !== "dump") {
    process.stderr.write(`unknown command: ${args[0]}\n`);
    printHelp();
    return 1;
  }
  const rest = args.slice(1);
  const fixture = argValue(rest, "--fixture");
  if (fixture !== undefined) {
    const dir = resolve(repoRoot, "fixtures", fixture);
    const manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8")) as {
      verilator: string;
      top: string;
    };
    const design = ingestFiles(
      resolve(dir, "verilator", `${manifest.top}.tree.json`),
      resolve(dir, "verilator", `${manifest.top}.meta.json`),
      {
        verilatorVersion: manifest.verilator,
        dumpedAt: "2026-09-18T00:00:00.000Z",
        topName: manifest.top,
      },
    );
    const out = resolve(dir, "golden", "schematic-ir.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, serializeDesign(design));
    process.stdout.write(`${out}\n`);
    return 0;
  }

  const positional = rest.filter((a, i, all) => !a.startsWith("--") && (i === 0 || !all[i - 1].startsWith("--")));
  if (positional.length < 2) {
    printHelp();
    return 1;
  }
  const top = argValue(rest, "--top");
  const out = argValue(rest, "--out") ?? "schematic-ir.json";
  const ver = argValue(rest, "--verilator-version") ?? "unknown";
  const design = ingestFiles(resolve(positional[0]), resolve(positional[1]), {
    verilatorVersion: ver,
    dumpedAt: "2026-09-18T00:00:00.000Z",
    topName: top,
  });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), serializeDesign(design));
  process.stdout.write(`${resolve(out)}\n`);
  return 0;
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry !== undefined && (entry.endsWith("/cli/src/main.ts") || entry.endsWith("/cli/src/index.ts"))) {
  process.exitCode = main(process.argv.slice(2));
}
