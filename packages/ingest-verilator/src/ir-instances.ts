import type { Instance, InstanceArray, Module, Net, SourceSpan } from "@ossschem/ir";
import { parseVerilogInt } from "./const.js";
import type { IdMint } from "./ids.js";
import type { VerilatorDump } from "./parse.js";
import { nodeSpan } from "./span.js";
import type { VerilatorNode } from "./types.js";

const INDEXED_GEN = /^(.+)\[(\d+)\]$/;
const GENBLK = /^genblk\d+$/;

function asNodes(value: unknown): VerilatorNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((n): n is VerilatorNode => typeof n === "object" && n !== null && typeof (n as VerilatorNode).type === "string");
}

function skipGenblock(block: VerilatorNode): boolean {
  if (block.implied === true) {
    return true;
  }
  return asNodes(block.itemsp).length === 0;
}

function liftGenblock(block: VerilatorNode): boolean {
  return block.unnamed === true || (typeof block.name === "string" && GENBLK.test(block.name));
}

type IdRef = string;

function bindExpr(
  dump: VerilatorDump,
  expr: VerilatorNode | undefined,
  netsByName: Map<string, Net>,
): { net: IdRef; bits?: { msb: number; lsb: number }; span: SourceSpan } | undefined {
  if (expr === undefined) {
    return undefined;
  }
  const span = nodeSpan(dump, expr);
  if (expr.type === "VARREF" && typeof expr.name === "string") {
    const net = netsByName.get(expr.name);
    if (net === undefined) {
      return undefined;
    }
    return { net: net.id, span };
  }
  if (expr.type === "SEL") {
    const from = asNodes(expr.fromp)[0];
    const lsbNode = asNodes(expr.lsbp)[0];
    const widthConst = typeof expr.widthConst === "number" ? expr.widthConst : 1;
    const lsbRaw = lsbNode?.type === "CONST" && typeof lsbNode.name === "string" ? parseVerilogInt(lsbNode.name) : "0";
    const lsb = Number(lsbRaw);
    const msb = lsb + widthConst - 1;
    const inner = bindExpr(dump, from, netsByName);
    if (inner === undefined) {
      return undefined;
    }
    return { net: inner.net, bits: { msb, lsb }, span };
  }
  return undefined;
}

function bindPins(dump: VerilatorDump, cell: VerilatorNode, netsByName: Map<string, Net>): Instance["pins"] {
  const pins: Instance["pins"] = [];
  for (const pin of asNodes(cell.pinsp)) {
    const port = typeof pin.name === "string" ? pin.name : "";
    const expr = asNodes(pin.exprp)[0];
    const bound = bindExpr(dump, expr, netsByName);
    if (bound === undefined) {
      continue;
    }
    pins.push({ port, net: bound.net, bits: bound.bits, span: bound.span });
  }
  return pins;
}

interface CollectedInstance {
  cell: VerilatorNode;
  generate?: string;
  arrayIndex?: number;
  relPath: string[];
}

function collectCells(stmts: VerilatorNode[], genStack: string[], into: CollectedInstance[]): void {
  for (const stmt of stmts) {
    if (stmt.type === "CELL") {
      const gen = genStack[genStack.length - 1];
      const indexed = gen !== undefined ? INDEXED_GEN.exec(gen) : null;
      into.push({
        cell: stmt,
        generate: indexed !== null ? indexed[1] : gen,
        arrayIndex: indexed !== null ? Number(indexed[2]) : undefined,
        relPath: [...genStack, typeof stmt.name === "string" ? stmt.name : ""],
      });
      continue;
    }
    if (stmt.type !== "GENBLOCK") {
      continue;
    }
    if (skipGenblock(stmt)) {
      continue;
    }
    const kids = asNodes(stmt.itemsp);
    if (liftGenblock(stmt)) {
      collectCells(kids, genStack, into);
      continue;
    }
    const name = typeof stmt.name === "string" ? stmt.name : "";
    collectCells(kids, [...genStack, name], into);
  }
}

export function ingestInstances(
  dump: VerilatorDump,
  ast: VerilatorNode,
  ir: Module,
  moduleIdByAddr: Map<string, string>,
  mint: IdMint,
): void {
  const netsByName = new Map(ir.nets.map((n) => [n.name, n]));
  const collected: CollectedInstance[] = [];
  collectCells(asNodes(ast.stmtsp), [], collected);

  const instances: Instance[] = [];
  for (const item of collected) {
    const modNode =
      typeof item.cell.modp === "string" ? dump.resolve(item.cell.modp) : undefined;
    const moduleId = modNode?.addr !== undefined ? moduleIdByAddr.get(modNode.addr) : undefined;
    if (moduleId === undefined) {
      continue;
    }
    const name = typeof item.cell.name === "string" ? item.cell.name : "";
    instances.push({
      kind: "instance",
      id: mint.next("i"),
      name,
      module: moduleId,
      relPath: item.relPath,
      pins: bindPins(dump, item.cell, netsByName),
      span: nodeSpan(dump, item.cell),
      arrayIndex: item.arrayIndex,
    });
  }

  const groups = new Map<string, Instance[]>();
  const ungrouped: Instance[] = [];
  for (const inst of instances) {
    if (inst.arrayIndex === undefined) {
      ungrouped.push(inst);
      continue;
    }
    const generate = inst.relPath[0]?.replace(/\[\d+\]$/, "") ?? "";
    const key = `${generate}\0${inst.name}\0${inst.module}`;
    const list = groups.get(key) ?? [];
    list.push(inst);
    groups.set(key, list);
  }

  const out: Module["instances"] = [...ungrouped];
  for (const [key, members] of groups) {
    members.sort((a, b) => (a.arrayIndex ?? 0) - (b.arrayIndex ?? 0));
    const [generate] = key.split("\0");
    if (members.length < 2) {
      out.push(...members);
      continue;
    }
    const indices = members.map((m) => m.arrayIndex ?? 0);
    const lsb = Math.min(...indices);
    const msb = Math.max(...indices);
    const array: InstanceArray = {
      kind: "instanceArray",
      id: mint.next("a"),
      name: members[0].name,
      module: members[0].module,
      generate,
      range: { msb, lsb },
      members: members.map((m) => m.id),
      span: members[0].span,
    };
    out.push(array, ...members);
  }

  ir.instances = out;
}
