import type { Net, Primitive, PrimitiveGraph, SourceSpan } from "@ossschem/ir";
import { prettyConst } from "@ossschem/ir";
import type { IdMint } from "./ids.js";
import type { VerilatorDump } from "./parse.js";
import { nodeSpan } from "./span.js";
import { asNodes, child } from "./stmts.js";
import type { VerilatorNode } from "./types.js";

interface WireRef {
  net: string;
  bits?: { msb: number; lsb: number };
}

interface Ctx {
  dump: VerilatorDump;
  netsByName: Map<string, Net>;
  mint: IdMint;
  cells: Primitive[];
  cse: Map<string, WireRef>;
  temps: Net[];
}

function spanOf(ctx: Ctx, node: VerilatorNode): SourceSpan {
  return nodeSpan(ctx.dump, node);
}

function tempNet(ctx: Ctx, widthBits = 1): string {
  const id = ctx.mint.next("t");
  ctx.temps.push({
    id,
    name: id,
    width: { msb: widthBits - 1, lsb: 0, packed: true },
    kind: "wire",
    span: { fileId: "?", file: "", startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    drivers: [],
    loads: [],
  });
  return id;
}

function emit(ctx: Ctx, cell: Primitive): Primitive {
  ctx.cells.push(cell);
  return cell;
}

function wrapNested(s: string): string {
  return `(${s})`;
}

function prettyAst(node: VerilatorNode | undefined, nested: boolean, shiftAmt = false): string {
  if (node === undefined) {
    return "?";
  }
  if (node.type === "VARREF" && typeof node.name === "string") {
    return node.name;
  }
  if (node.type === "CONST" && typeof node.name === "string") {
    return prettyConst(node.name, shiftAmt);
  }
  if (node.type === "EXTEND") {
    return prettyAst(child(node, "lhsp") ?? child(node, "fromp"), nested);
  }
  if (node.type === "NOT") {
    const inner = prettyAst(child(node, "lhsp"), false);
    return `~${inner}`;
  }
  if (node.type === "SEL") {
    const from = prettyAst(child(node, "fromp"), false);
    const width = typeof node.widthConst === "number" ? node.widthConst : 1;
    const lsbTok = child(node, "lsbp");
    const lsb = lsbTok?.type === "CONST" && typeof lsbTok.name === "string" ? Number(prettyConst(lsbTok.name, true)) : 0;
    const msb = lsb + width - 1;
    return width === 1 ? `${from}[${lsb}]` : `${from}[${msb}:${lsb}]`;
  }
  if (node.type === "ARRAYSEL") {
    return `${prettyAst(child(node, "fromp"), false)}[${prettyAst(child(node, "bitp"), false)}]`;
  }
  if (node.type === "CONCAT") {
    const parts = [...asNodes(node.lhsp), ...asNodes(node.rhsp)].map((p) => prettyAst(p, false));
    return `{${parts.join(", ")}}`;
  }
  const bin: Record<string, string> = {
    AND: "&",
    LOGAND: "&",
    OR: "|",
    LOGOR: "|",
    XOR: "^",
    EQ: "==",
    ADD: "+",
    SHIFTR: ">>",
    SHIFTL: "<<",
  };
  const op = bin[node.type];
  if (op !== undefined) {
    const amount = node.type === "SHIFTR" || node.type === "SHIFTL";
    const l = prettyAst(child(node, "lhsp"), true);
    const r = prettyAst(child(node, "rhsp"), true, amount);
    return nested ? wrapNested(`${l} ${op} ${r}`) : `${l} ${op} ${r}`;
  }
  return node.type.toLowerCase();
}

function bindVar(ctx: Ctx, name: string): WireRef | undefined {
  const net = ctx.netsByName.get(name);
  return net === undefined ? undefined : { net: net.id };
}

export function lowerExpr(ctx: Ctx, node: VerilatorNode | undefined): WireRef | undefined {
  if (node === undefined) {
    return undefined;
  }
  if (typeof node.addr === "string") {
    const hit = ctx.cse.get(node.addr);
    if (hit !== undefined) {
      return hit;
    }
  }
  let out: WireRef | undefined;
  if (node.type === "VARREF" && typeof node.name === "string") {
    out = bindVar(ctx, node.name);
  } else if (node.type === "EXTEND") {
    out = lowerExpr(ctx, child(node, "lhsp") ?? child(node, "fromp"));
  } else if (node.type === "CONST") {
    const y = tempNet(ctx);
    const value = typeof node.name === "string" ? node.name : "0";
    emit(ctx, {
      id: ctx.mint.next("c"),
      kind: "const",
      params: { value: prettyConst(value) },
      pins: { Y: { net: y } },
      span: spanOf(ctx, node),
      expr: prettyAst(node, false),
    });
    out = { net: y };
  } else if (node.type === "NOT") {
    const a = lowerExpr(ctx, child(node, "lhsp"));
    if (a !== undefined) {
      const y = tempNet(ctx);
      emit(ctx, {
        id: ctx.mint.next("c"),
        kind: "not",
        pins: { A: a, Y: { net: y } },
        span: spanOf(ctx, node),
        expr: prettyAst(node, false),
      });
      out = { net: y };
    }
  } else if (node.type === "SEL") {
    const a = lowerExpr(ctx, child(node, "fromp"));
    const width = typeof node.widthConst === "number" ? node.widthConst : 1;
    const lsbTok = child(node, "lsbp");
    const lsb = lsbTok?.type === "CONST" && typeof lsbTok.name === "string" ? Number(prettyConst(lsbTok.name, true)) : 0;
    const msb = lsb + width - 1;
    if (a !== undefined) {
      const y = tempNet(ctx);
      emit(ctx, {
        id: ctx.mint.next("c"),
        kind: "slice",
        params: { msb, lsb },
        pins: { A: a, Y: { net: y } },
        span: spanOf(ctx, node),
        expr: prettyAst(node, false),
      });
      out = { net: y, bits: { msb, lsb } };
    }
  } else if (node.type === "ARRAYSEL") {
    const mem = lowerExpr(ctx, child(node, "fromp"));
    const addr = lowerExpr(ctx, child(node, "bitp"));
    if (mem !== undefined && addr !== undefined) {
      const y = tempNet(ctx);
      emit(ctx, {
        id: ctx.mint.next("c"),
        kind: "memrd",
        pins: { MEM: mem, ADDR: addr, Y: { net: y } },
        span: spanOf(ctx, node),
        expr: prettyAst(node, false),
      });
      out = { net: y };
    }
  } else if (node.type === "CONCAT") {
    const parts = [...asNodes(node.lhsp), ...asNodes(node.rhsp)];
    const pins: Primitive["pins"] = {};
    parts.forEach((p, i) => {
      const w = lowerExpr(ctx, p);
      if (w !== undefined) {
        pins[`A${i}`] = w;
      }
    });
    const y = tempNet(ctx);
    emit(ctx, {
      id: ctx.mint.next("c"),
      kind: "concat",
      pins: { ...pins, Y: { net: y } },
      span: spanOf(ctx, node),
      expr: prettyAst(node, false),
    });
    out = { net: y };
  } else {
    const kinds: Record<string, Primitive["kind"]> = {
      AND: "and",
      LOGAND: "and",
      OR: "or",
      LOGOR: "or",
      XOR: "xor",
      EQ: "eq",
      ADD: "add",
      SHIFTR: "shiftr",
      SHIFTL: "shiftl",
    };
    const kind = kinds[node.type];
    if (kind !== undefined) {
      const a = lowerExpr(ctx, child(node, "lhsp"));
      const bNode = child(node, "rhsp");
      const b = lowerExpr(ctx, bNode);
      if (a !== undefined) {
        const y = tempNet(ctx);
        const params: Record<string, string | number> = {};
        if ((kind === "shiftr" || kind === "shiftl") && bNode?.type === "CONST" && typeof bNode.name === "string") {
          params.amount = prettyConst(bNode.name, true);
        }
        const pins: Primitive["pins"] = { A: a, Y: { net: y } };
        if (b !== undefined && params.amount === undefined) {
          pins.B = b;
        }
        emit(ctx, {
          id: ctx.mint.next("c"),
          kind,
          params: Object.keys(params).length > 0 ? params : undefined,
          pins,
          span: spanOf(ctx, node),
          expr: prettyAst(node, false),
        });
        out = { net: y };
      }
    }
  }
  if (out === undefined) {
    const y = tempNet(ctx);
    emit(ctx, {
      id: ctx.mint.next("c"),
      kind: "opaque",
      pins: { Y: { net: y } },
      span: spanOf(ctx, node),
      reason: { astType: node.type, loc: spanOf(ctx, node) },
    });
    out = { net: y };
  }
  if (typeof node.addr === "string") {
    ctx.cse.set(node.addr, out);
  }
  return out;
}

function lhsTarget(assign: VerilatorNode): { name: string; array?: VerilatorNode } | undefined {
  const lhs = child(assign, "lhsp");
  if (lhs === undefined) {
    return undefined;
  }
  if (lhs.type === "VARREF" && typeof lhs.name === "string") {
    return { name: lhs.name };
  }
  if (lhs.type === "ARRAYSEL") {
    const from = child(lhs, "fromp");
    if (from?.type === "VARREF" && typeof from.name === "string") {
      return { name: from.name, array: lhs };
    }
  }
  return undefined;
}

function isConst(node: VerilatorNode | undefined): string | undefined {
  return node?.type === "CONST" && typeof node.name === "string" ? node.name : undefined;
}

function condName(cond: VerilatorNode | undefined): string | undefined {
  if (cond?.type === "VARREF") {
    return cond.name;
  }
  if (cond?.type === "NOT") {
    return condName(child(cond, "lhsp"));
  }
  return undefined;
}

interface AssignHit {
  node: VerilatorNode;
  rhs: VerilatorNode | undefined;
  ifConds: VerilatorNode[];
}

function collectAssigns(root: VerilatorNode): AssignHit[] {
  const hits: AssignHit[] = [];
  const visit = (node: VerilatorNode, ifs: VerilatorNode[]): void => {
    if (node.type === "ASSIGNDLY" || node.type === "ASSIGN" || node.type === "ASSIGNW") {
      hits.push({ node, rhs: child(node, "rhsp"), ifConds: ifs });
      return;
    }
    if (node.type === "IF") {
      const cond = child(node, "condp");
      const next = cond !== undefined ? [...ifs, cond] : ifs;
      for (const t of asNodes(node.thensp)) {
        visit(t, next);
      }
      for (const e of asNodes(node.elsesp)) {
        visit(e, ifs);
      }
      return;
    }
    for (const v of Object.values(node)) {
      for (const c of asNodes(v)) {
        visit(c, ifs);
      }
    }
  };
  visit(root, []);
  return hits;
}

function clockNet(always: VerilatorNode, ctx: Ctx): WireRef | undefined {
  for (const tree of asNodes(always.sentreep)) {
    for (const sen of asNodes(tree.sensesp)) {
      if (sen.edgeType === "POS") {
        const n = child(sen, "sensp");
        if (n?.type === "VARREF" && typeof n.name === "string") {
          return bindVar(ctx, n.name);
        }
      }
    }
  }
  return undefined;
}

function resetNetName(always: VerilatorNode): string | undefined {
  for (const tree of asNodes(always.sentreep)) {
    for (const sen of asNodes(tree.sensesp)) {
      if (sen.edgeType === "NEG") {
        const n = child(sen, "sensp");
        if (n?.type === "VARREF" && typeof n.name === "string") {
          return n.name;
        }
      }
    }
  }
  return undefined;
}

function retargetY(cell: Primitive, net: string): void {
  if (cell.pins.Y !== undefined) {
    cell.pins.Y = { net };
  }
}

function connectTo(ctx: Ctx, src: WireRef | undefined, destName: string, span: SourceSpan): void {
  const dest = bindVar(ctx, destName);
  if (src === undefined || dest === undefined) {
    return;
  }
  if (src.net === dest.net) {
    return;
  }
  const last = ctx.cells.find((c) => c.pins.Y?.net === src.net);
  if (last !== undefined) {
    retargetY(last, dest.net);
    return;
  }
  emit(ctx, {
    id: ctx.mint.next("c"),
    kind: "buf",
    pins: { A: src, Y: dest },
    span,
  });
}

function lowerSeq(ctx: Ctx, always: VerilatorNode): void {
  const clk = clockNet(always, ctx);
  const rstName = resetNetName(always);
  const rst = rstName !== undefined ? bindVar(ctx, rstName) : undefined;
  const assigns = collectAssigns(always);
  const byLhs = new Map<string, AssignHit[]>();
  for (const a of assigns) {
    const lhs = lhsTarget(a.node);
    if (lhs === undefined) {
      continue;
    }
    const list = byLhs.get(lhs.name) ?? [];
    list.push(a);
    byLhs.set(lhs.name, list);
  }

  for (const [qName, hits] of byLhs) {
    const q = bindVar(ctx, qName);
    if (q === undefined) {
      continue;
    }
    const memHit = hits.find((h) => lhsTarget(h.node)?.array !== undefined);
    if (memHit !== undefined) {
      const lhs = lhsTarget(memHit.node);
      const addrNode = lhs?.array !== undefined ? child(lhs.array, "bitp") : undefined;
      const d = lowerExpr(ctx, memHit.rhs);
      const addr = lowerExpr(ctx, addrNode);
      const weCond = memHit.ifConds[memHit.ifConds.length - 1];
      const we = weCond !== undefined ? lowerExpr(ctx, weCond) : undefined;
      const pins: Primitive["pins"] = { Q: q };
      if (clk !== undefined) {
        pins.CLK = clk;
      }
      if (d !== undefined) {
        pins.D = d;
      }
      if (addr !== undefined) {
        pins.ADDR = addr;
      }
      if (we !== undefined) {
        pins.WE = we;
      }
      emit(ctx, {
        id: ctx.mint.next("c"),
        kind: "memwr",
        pins,
        span: spanOf(ctx, memHit.node),
      });
      continue;
    }

    const constHit = hits.find((h) => isConst(h.rhs) !== undefined);
    const dataHit = hits.find((h) => isConst(h.rhs) === undefined) ?? hits[0];
    const rstVal = constHit !== undefined ? prettyConst(isConst(constHit.rhs) ?? "0") : undefined;
    const d = lowerExpr(ctx, dataHit.rhs);
    const nestedEn = dataHit.ifConds.find((c) => condName(c) !== rstName);
    const pins: Primitive["pins"] = { Q: q };
    if (clk !== undefined) {
      pins.CLK = clk;
    }
    if (d !== undefined) {
      pins.D = d;
    }
    let kind: Primitive["kind"] = "dff";
    const params: Record<string, string | number> = {};
    if (rst !== undefined && rstVal !== undefined) {
      pins.ARST = rst;
      params.RST_VAL = rstVal;
      if (nestedEn !== undefined) {
        const en = lowerExpr(ctx, nestedEn);
        if (en !== undefined) {
          pins.EN = en;
        }
        kind = "adffe";
      } else {
        kind = "adff";
      }
    } else if (dataHit.ifConds.length > 0) {
      const en = lowerExpr(ctx, dataHit.ifConds[dataHit.ifConds.length - 1]);
      if (en !== undefined) {
        pins.EN = en;
      }
      kind = "dffe";
    }
    emit(ctx, {
      id: ctx.mint.next("c"),
      kind,
      params: Object.keys(params).length > 0 ? params : undefined,
      pins,
      span: spanOf(ctx, dataHit.node),
    });
  }
}

function lowerComb(ctx: Ctx, always: VerilatorNode): void {
  for (const hit of collectAssigns(always)) {
    const lhs = lhsTarget(hit.node);
    if (lhs === undefined) {
      continue;
    }
    const src = lowerExpr(ctx, hit.rhs);
    connectTo(ctx, src, lhs.name, spanOf(ctx, hit.node));
  }
}

export function lowerAlways(
  dump: VerilatorDump,
  always: VerilatorNode,
  netsByName: Map<string, Net>,
  mint: IdMint,
): PrimitiveGraph {
  const ctx: Ctx = { dump, netsByName, mint, cells: [], cse: new Map(), temps: [] };
  const kw = always.keyword;
  if (kw === "always_ff") {
    lowerSeq(ctx, always);
  } else {
    lowerComb(ctx, always);
  }
  return { nets: ctx.temps, cells: ctx.cells };
}
