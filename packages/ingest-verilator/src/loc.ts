import { basename } from "node:path";
import type { ParsedLoc, SourceLoc, VerilatorMeta } from "./types.js";

const LOC_RE = /^([^,]+),(\d+):(\d+),(\d+):(\d+)$/;

export function parseLoc(raw: string): ParsedLoc {
  const match = LOC_RE.exec(raw);
  if (match === null) {
    throw new Error(`invalid Verilator loc: ${JSON.stringify(raw)}`);
  }
  return {
    fileId: match[1],
    firstLine: Number(match[2]),
    firstCol: Number(match[3]),
    lastLine: Number(match[4]),
    endCol: Number(match[5]),
  };
}

export function resolveLoc(raw: string | undefined, meta: VerilatorMeta): SourceLoc | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const parsed = parseLoc(raw);
  const file = meta.files[parsed.fileId];
  const filename = file?.filename ?? parsed.fileId;
  return {
    ...parsed,
    filename,
    basename: basename(filename),
  };
}
