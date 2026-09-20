import { danglingPointers, indexByAddr, resolveAddr } from "./addr.js";
import { resolveDtype } from "./dtype.js";
import { resolveLoc } from "./loc.js";
import {
  RESOLVED_PTR_FIELDS,
  type DanglingPtr,
  type ResolvedDtype,
  type SourceLoc,
  type VerilatorMeta,
  type VerilatorNode,
} from "./types.js";
import { isNode } from "./walk.js";

export interface VerilatorDump {
  tree: VerilatorNode;
  meta: VerilatorMeta;
  byAddr: Map<string, VerilatorNode>;
  resolve(addr: string | undefined): VerilatorNode | undefined;
  loc(nodeOrRaw: VerilatorNode | string | undefined): SourceLoc | undefined;
  dtype(addr: string | undefined): ResolvedDtype | undefined;
  dangling(fields?: readonly string[]): DanglingPtr[];
}

function parseMeta(meta: unknown): VerilatorMeta {
  if (typeof meta !== "object" || meta === null) {
    throw new Error("Verilator meta.json must be an object");
  }
  const files = (meta as { files?: unknown }).files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    throw new Error("Verilator meta.json missing files map");
  }
  return meta as VerilatorMeta;
}

export function parseVerilatorDump(tree: unknown, meta: unknown): VerilatorDump {
  if (!isNode(tree) || tree.type !== "NETLIST") {
    throw new Error("Verilator tree.json root must be a NETLIST node");
  }
  const parsedMeta = parseMeta(meta);
  const byAddr = indexByAddr(tree);

  return {
    tree,
    meta: parsedMeta,
    byAddr,
    resolve: (addr) => resolveAddr(byAddr, addr),
    loc: (nodeOrRaw) => {
      const raw = typeof nodeOrRaw === "string" ? nodeOrRaw : nodeOrRaw?.loc;
      return resolveLoc(raw, parsedMeta);
    },
    dtype: (addr) => resolveDtype(byAddr, addr),
    dangling: (fields = RESOLVED_PTR_FIELDS) => danglingPointers(tree, byAddr, fields),
  };
}
