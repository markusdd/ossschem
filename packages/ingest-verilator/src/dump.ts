import { readFileSync } from "node:fs";
import { ingestToIr, type IngestOptions } from "./ir-modules.js";
import { parseVerilatorDump } from "./parse.js";

export function ingestFiles(treePath: string, metaPath: string, options: IngestOptions) {
  const tree = JSON.parse(readFileSync(treePath, "utf8")) as unknown;
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as unknown;
  return ingestToIr(parseVerilatorDump(tree, meta), options);
}
