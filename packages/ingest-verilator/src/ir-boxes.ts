import type { AlwaysBox, AssignBox, BoxPort, Module, Net, Sense } from "@ossschem/ir";
import type { IdMint } from "./ids.js";
import { lowerAlways } from "./lower.js";
import type { VerilatorDump } from "./parse.js";
import { collectNetRefs } from "./refs.js";
import { nodeSpan } from "./span.js";
import { alwaysSpan, assignSpan, spanFromRaw } from "./span-union.js";
import { asNodes, forEachLiftedStmt } from "./stmts.js";
import type { VerilatorNode } from "./types.js";

function firstNamedBegin(root: VerilatorNode): string | undefined {
  const stack: VerilatorNode[] = [root];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node === undefined) {
      break;
    }
    if (node.type === "BEGIN" && typeof node.name === "string" && node.name.length > 0) {
      return node.name;
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        stack.push(...asNodes(child));
      } else if (typeof child === "object" && child !== null && typeof (child as VerilatorNode).type === "string") {
        stack.push(child as VerilatorNode);
      }
    }
  }
  return undefined;
}

function edgeOf(sen: VerilatorNode): Sense["edge"] {
  if (sen.edgeType === "POS") {
    return "pos";
  }
  if (sen.edgeType === "NEG") {
    return "neg";
  }
  return "level";
}

function senses(dump: VerilatorDump, always: VerilatorNode, netsByName: Map<string, Net>): {
  clocks: Sense[];
  resets: Sense[];
} {
  const clocks: Sense[] = [];
  const resets: Sense[] = [];
  for (const tree of asNodes(always.sentreep)) {
    for (const sen of asNodes(tree.sensesp)) {
      const ref = asNodes(sen.sensp)[0];
      const net = typeof ref?.name === "string" ? netsByName.get(ref.name) : undefined;
      if (net === undefined) {
        continue;
      }
      const sense: Sense = {
        edge: edgeOf(sen),
        net: net.id,
        span: spanFromRaw(dump, sen.loc) ?? nodeSpan(dump, sen),
      };
      if (sense.edge === "neg") {
        resets.push(sense);
      } else {
        clocks.push(sense);
      }
    }
  }
  return { clocks, resets };
}

function boxPorts(
  refs: ReturnType<typeof collectNetRefs>,
  netsByName: Map<string, Net>,
  clockNets: Set<string>,
  resetNets: Set<string>,
): BoxPort[] {
  const ins = new Map<string, BoxPort>();
  const outs = new Map<string, BoxPort>();
  for (const ref of refs) {
    const net = netsByName.get(ref.name);
    if (net === undefined) {
      continue;
    }
    const dir = ref.access === "WR" ? "out" : "in";
    const table = dir === "out" ? outs : ins;
    const prev = table.get(net.id);
    if (prev === undefined) {
      const port: BoxPort = { name: ref.name, dir, net: net.id };
      if (ref.bits !== undefined) {
        port.bits = ref.bits;
      }
      table.set(net.id, port);
    } else if (prev.bits !== undefined && ref.bits !== undefined) {
      prev.bits = {
        msb: Math.max(prev.bits.msb, ref.bits.msb),
        lsb: Math.min(prev.bits.lsb, ref.bits.lsb),
      };
    } else {
      prev.bits = undefined;
    }
  }

  const clockPorts = [...clockNets]
    .map((id) => ins.get(id))
    .filter((p): p is BoxPort => p !== undefined);
  const resetPorts = [...resetNets]
    .map((id) => ins.get(id))
    .filter((p): p is BoxPort => p !== undefined);
  // Inputs = read here but not produced here. Outputs = written here.
  // Intermediates that are both WR and RD inside the same process stay internal.
  const dataIns = [...ins.values()]
    .filter((p) => !clockNets.has(p.net) && !resetNets.has(p.net) && !outs.has(p.net))
    .sort((a, b) => a.name.localeCompare(b.name));
  const dataOuts = [...outs.values()].sort((a, b) => a.name.localeCompare(b.name));
  return [...clockPorts, ...resetPorts, ...dataIns, ...dataOuts];
}

export function ingestBoxes(dump: VerilatorDump, ast: VerilatorNode, ir: Module, mint: IdMint): void {
  const netsByName = new Map(ir.nets.map((n) => [n.name, n]));
  const boxes: Module["boxes"] = [];

  forEachLiftedStmt(asNodes(ast.stmtsp), (stmt) => {
    if (stmt.type !== "ALWAYS") {
      return;
    }
    const keywordRaw = typeof stmt.keyword === "string" ? stmt.keyword : "always";
    const refs = collectNetRefs(stmt);

    if (keywordRaw === "cont_assign") {
      const wr = refs.find((r) => r.access === "WR");
      const name = wr !== undefined ? `assign ${wr.name}` : "assign";
      const box: AssignBox = {
        kind: "assign",
        id: mint.next("b"),
        name,
        span: assignSpan(dump, stmt) ?? nodeSpan(dump, stmt),
        ports: boxPorts(refs, netsByName, new Set(), new Set()),
        contents: lowerAlways(dump, stmt, netsByName, mint),
      };
      boxes.push(box);
      attachBoxRefs(box.id, refs, netsByName);
      return;
    }

    const begin = firstNamedBegin(stmt);
    const { clocks, resets } = senses(dump, stmt, netsByName);
    const clockNets = new Set(clocks.map((c) => c.net));
    const resetNets = new Set(resets.map((c) => c.net));
    const keyword: AlwaysBox["keyword"] =
      keywordRaw === "always_ff" || keywordRaw === "always_comb" ? keywordRaw : "always";
    const box: AlwaysBox = {
      kind: "always",
      id: mint.next("b"),
      name: begin ?? `${keyword}@L${nodeSpan(dump, stmt).startLine}`,
      keyword,
      clocks,
      resets,
      span: alwaysSpan(dump, stmt) ?? nodeSpan(dump, stmt),
      ports: boxPorts(refs, netsByName, clockNets, resetNets),
      contents: lowerAlways(dump, stmt, netsByName, mint),
    };
    boxes.push(box);
    attachBoxRefs(box.id, refs, netsByName);
  });

  ir.boxes = boxes;
}

function attachBoxRefs(
  boxId: string,
  refs: ReturnType<typeof collectNetRefs>,
  netsByName: Map<string, Net>,
): void {
  for (const ref of refs) {
    const net = netsByName.get(ref.name);
    if (net === undefined) {
      continue;
    }
    const ep = { kind: "box" as const, box: boxId, pin: ref.name, bits: ref.bits };
    if (ref.access === "WR") {
      net.drivers.push(ep);
    } else {
      net.loads.push(ep);
    }
  }
}
