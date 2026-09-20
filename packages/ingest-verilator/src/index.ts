import { packageName as irPackage } from "@ossschem/ir";

export const packageName = "@ossschem/ingest-verilator" as const;

export function ingestReady(): boolean {
  return irPackage === "@ossschem/ir";
}

export { danglingPointers, indexByAddr, resolveAddr } from "./addr.js";
export { parseVerilogInt } from "./const.js";
export { resolveDtype, widthFromRange } from "./dtype.js";
export { ingestFiles } from "./dump.js";
export { ingestToIr, type IngestOptions } from "./ir-modules.js";
export { parseLoc, resolveLoc } from "./loc.js";
export { parseVerilatorDump, type VerilatorDump } from "./parse.js";
export { isNode, walkNodes } from "./walk.js";
export {
  RESOLVED_PTR_FIELDS,
  UNLINKED,
  type DanglingPtr,
  type ParsedLoc,
  type PtrField,
  type ResolvedDtype,
  type SourceLoc,
  type VerilatorMeta,
  type VerilatorNode,
  type Width,
} from "./types.js";
