/** Untyped Verilator AST node. Fields vary by `type`; pointer fields are addr strings. */
export interface VerilatorNode {
  type: string;
  name?: string;
  addr?: string;
  loc?: string;
  [key: string]: unknown;
}

export interface VerilatorFileMeta {
  filename: string;
  realpath?: string;
  language?: string;
}

export interface VerilatorMeta {
  files: Record<string, VerilatorFileMeta>;
  pointers?: Record<string, string>;
  ptrFieldNames?: string[];
}

export const UNLINKED = "UNLINKED";

/** Pointer fields we resolve for ingest. `addr` is an identity, not a link. */
export const RESOLVED_PTR_FIELDS = [
  "varp",
  "modp",
  "dtypep",
  "refDTypep",
  "modVarp",
] as const;

export type PtrField = (typeof RESOLVED_PTR_FIELDS)[number];

export interface ParsedLoc {
  fileId: string;
  firstLine: number;
  firstCol: number;
  lastLine: number;
  /** Exclusive, as emitted by Verilator. */
  endCol: number;
}

export interface SourceLoc extends ParsedLoc {
  filename: string;
  basename: string;
}

export interface Width {
  msb: number;
  lsb: number;
  packed: boolean;
}

export type DtypeKind = "basic" | "unpackArray" | "unknown";

export interface ResolvedDtype {
  addr: string;
  kind: DtypeKind;
  keyword?: string;
  /** Packed bit range of the element (or the scalar). Missing range and `0:0` → `{msb:0,lsb:0}`. */
  width: Width;
  /** Unpacked dimension, if any (`fifo_mem_r` is `[15:0]` of `logic [31:0]`). */
  unpacked?: Width;
}

export interface DanglingPtr {
  field: string;
  addr: string;
  nodeType: string;
  name?: string;
}
