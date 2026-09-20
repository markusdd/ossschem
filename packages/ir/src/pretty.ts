import type { Primitive, PrimitiveGraph } from "./types.js";

const BIN: Record<string, string> = {
  and: "&",
  or: "|",
  xor: "^",
  eq: "==",
  add: "+",
  shiftr: ">>",
  shiftl: "<<",
};

export function prettyConst(token: string, asShiftAmount = false): string {
  const sized = /^(\d+)'s?([hbdHoBoD])([0-9a-fA-FxXzZ_]+)$/.exec(token);
  if (sized === null) {
    return token;
  }
  const baseMap: Record<string, number> = { h: 16, H: 16, b: 2, B: 2, d: 10, D: 10, o: 8, O: 8 };
  const digits = sized[3].replace(/_/g, "");
  if (/[xXzZ]/.test(digits)) {
    return token;
  }
  const n = parseInt(digits, baseMap[sized[2]]);
  if (asShiftAmount) {
    return String(n);
  }
  if (sized[1] === "1" && (n === 0 || n === 1)) {
    return n === 0 ? "1'b0" : "1'b1";
  }
  if (n.toString(10).length <= 6) {
    return String(n);
  }
  return `${sized[1]}'d${n}`;
}

function wrap(s: string, nested: boolean): string {
  return nested ? `(${s})` : s;
}

function pinNet(cell: Primitive, pin: string): string | undefined {
  return cell.pins[pin]?.net;
}

/** Pretty-print a primitive's output, parenthesizing nested binaries, not the root. */
export function prettyPrimitive(cell: Primitive, graph: PrimitiveGraph, nested = false): string {
  if (cell.expr !== undefined && cell.expr.length > 0) {
    return nested && /[ ?:&|^+<>]/.test(cell.expr) ? `(${cell.expr})` : cell.expr;
  }
  const byOut = new Map<string, Primitive>();
  for (const c of graph.cells) {
    const y = c.pins.Y?.net ?? c.pins.Q?.net;
    if (y !== undefined) {
      byOut.set(y, c);
    }
  }
  const rec = (net: string | undefined, nest: boolean): string => {
    if (net === undefined) {
      return "?";
    }
    const src = byOut.get(net);
    if (src === undefined) {
      return net;
    }
    return prettyPrimitive(src, graph, nest);
  };
  if (cell.kind === "const") {
    return prettyConst(String(cell.params?.value ?? "0"));
  }
  if (cell.kind === "not") {
    return `~${rec(pinNet(cell, "A"), false)}`;
  }
  if (cell.kind === "slice") {
    const msb = Number(cell.params?.msb ?? 0);
    const lsb = Number(cell.params?.lsb ?? 0);
    const from = rec(pinNet(cell, "A"), false);
    return msb === lsb ? `${from}[${lsb}]` : `${from}[${msb}:${lsb}]`;
  }
  if (cell.kind === "concat") {
    const parts = Object.keys(cell.pins)
      .filter((k) => k.startsWith("A"))
      .sort()
      .map((k) => rec(cell.pins[k]?.net, false));
    return `{${parts.join(", ")}}`;
  }
  if (cell.kind === "mux") {
    return wrap(`${rec(pinNet(cell, "S"), true)} ? ${rec(pinNet(cell, "B"), true)} : ${rec(pinNet(cell, "A"), true)}`, nested);
  }
  if (cell.kind === "memrd") {
    return `${rec(pinNet(cell, "MEM"), false)}[${rec(pinNet(cell, "ADDR"), false)}]`;
  }
  if (cell.kind === "buf") {
    return rec(pinNet(cell, "A"), nested);
  }
  if (cell.kind === "extend") {
    return rec(pinNet(cell, "A"), nested);
  }
  const op = BIN[cell.kind];
  if (op !== undefined) {
    const amount = cell.kind === "shiftr" || cell.kind === "shiftl";
    const rhs = amount ? prettyConst(String(cell.params?.amount ?? rec(pinNet(cell, "B"), true)), true) : rec(pinNet(cell, "B"), true);
    return wrap(`${rec(pinNet(cell, "A"), true)} ${op} ${rhs}`, nested);
  }
  if (cell.kind === "opaque") {
    return cell.reason?.astType ?? "opaque";
  }
  return cell.kind;
}

export function prettyNet(netId: string, graph: PrimitiveGraph): string {
  const cell = [...graph.cells].reverse().find((c) => c.pins.Y?.net === netId || c.pins.Q?.net === netId);
  if (cell === undefined) {
    return netId;
  }
  const s = prettyPrimitive(cell, graph, false);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}
