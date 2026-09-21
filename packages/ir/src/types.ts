export type Id = string;
export type HierPath = string[];

/** Canvas / selection / probe key. Never a bare Net.id. */
export interface ViewId {
  path: HierPath;
  irId: Id;
}

export interface SourceSpan {
  fileId: string;
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export type Bit = 0 | 1 | "x" | "z";

/** Packed [msb:lsb]. Scalar logic with no BASICDTYPE.range, and range "0:0", both become {msb:0,lsb:0,packed:true}. */
export interface Width {
  msb: number;
  lsb: number;
  packed: boolean;
}

export interface Design {
  schemaVersion: 1;
  top: Id;
  modules: Record<Id, Module>;
  files: Record<string, { path: string; language: string }>;
  meta: { producer: "verilator-json-only"; verilatorVersion: string; dumpedAt: string };
}

export interface Module {
  id: Id;
  name: string;
  origName: string;
  span: SourceSpan;
  params: Param[];
  ports: Port[];
  nets: Net[];
  boxes: (AlwaysBox | AssignBox)[];
  instances: (Instance | InstanceArray)[];
}

export interface Param {
  name: string;
  value: string;
  width: Width;
  span: SourceSpan;
}

export interface Port {
  id: Id;
  name: string;
  dir: "input" | "output" | "inout";
  net: Id;
  span: SourceSpan;
}

export interface Net {
  id: Id;
  name: string;
  width: Width;
  kind: "port" | "reg" | "wire" | "memory";
  /** `range` is the declared unpacked range, which names the elements. */
  memory?: { depth: number; packed: Width; range?: { msb: number; lsb: number } };
  span: SourceSpan;
  drivers: Endpoint[];
  loads: Endpoint[];
}

export interface Endpoint {
  kind: "box" | "port" | "const";
  box?: Id;
  port?: Id;
  pin: string;
  bits?: { msb: number; lsb: number };
}

export interface AlwaysBox {
  kind: "always";
  id: Id;
  name: string;
  keyword: "always_ff" | "always_comb" | "always";
  clocks: Sense[];
  resets: Sense[];
  span: SourceSpan;
  ports: BoxPort[];
  contents: PrimitiveGraph;
}

export interface AssignBox {
  kind: "assign";
  id: Id;
  name: string;
  span: SourceSpan;
  ports: BoxPort[];
  contents: PrimitiveGraph;
}

export interface Sense {
  edge: "pos" | "neg" | "level";
  net: Id;
  span: SourceSpan;
}

export interface BoxPort {
  name: string;
  dir: "in" | "out";
  net: Id;
  bits?: { msb: number; lsb: number };
}

export interface Instance {
  kind: "instance";
  id: Id;
  name: string;
  module: Id;
  relPath: string[];
  /** `bits` selects within a packed vector, `element` one entry of an unpacked array. */
  pins: { port: string; net: Id; bits?: { msb: number; lsb: number }; element?: number; span: SourceSpan }[];
  span: SourceSpan;
  arrayIndex?: number;
}

export interface InstanceArray {
  kind: "instanceArray";
  id: Id;
  name: string;
  module: Id;
  generate: string;
  range: { msb: number; lsb: number };
  members: Id[];
  span: SourceSpan;
}

export type PrimKind =
  | "dff"
  | "adff"
  | "dffe"
  | "adffe"
  | "mux"
  | "and"
  | "or"
  | "xor"
  | "not"
  | "eq"
  | "add"
  | "sub"
  | "shiftr"
  | "shiftl"
  | "concat"
  | "slice"
  | "extend"
  | "const"
  | "memrd"
  | "memwr"
  | "buf"
  | "opaque";

export interface Primitive {
  id: Id;
  kind: PrimKind;
  params?: Record<string, string | number>;
  pins: Record<string, { net: Id; bits?: { msb: number; lsb: number } }>;
  span: SourceSpan;
  expr?: string;
  reason?: { astType: string; loc: SourceSpan };
}

export interface PrimitiveGraph {
  nets: Net[];
  cells: Primitive[];
}

export const EMPTY_PRIMITIVE_GRAPH: PrimitiveGraph = { nets: [], cells: [] };
