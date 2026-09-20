import { parseVerilogInt } from "./const.js";
import { asNodes } from "./stmts.js";
import type { VerilatorNode } from "./types.js";

export interface NetRef {
  name: string;
  access: "RD" | "WR" | string;
  bits?: { msb: number; lsb: number };
  node: VerilatorNode;
}

function selBits(sel: VerilatorNode): { msb: number; lsb: number } | undefined {
  const lsbNode = asNodes(sel.lsbp)[0];
  const widthConst = typeof sel.widthConst === "number" ? sel.widthConst : 1;
  if (lsbNode?.type !== "CONST" || typeof lsbNode.name !== "string") {
    return undefined;
  }
  const lsb = Number(parseVerilogInt(lsbNode.name));
  return { msb: lsb + widthConst - 1, lsb };
}

export function collectNetRefs(root: VerilatorNode): NetRef[] {
  const refs: NetRef[] = [];

  const visit = (node: VerilatorNode, bits: { msb: number; lsb: number } | undefined): void => {
    if (node.type === "SEL") {
      const next = selBits(node);
      for (const child of asNodes(node.fromp)) {
        visit(child, next ?? bits);
      }
      return;
    }
    if (node.type === "VARREF" && typeof node.name === "string") {
      refs.push({
        name: node.name,
        access: typeof node.access === "string" ? node.access : "RD",
        bits,
        node,
      });
      return;
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        for (const c of asNodes(child)) {
          visit(c, bits);
        }
      } else if (typeof child === "object" && child !== null && typeof (child as VerilatorNode).type === "string") {
        visit(child as VerilatorNode, bits);
      }
    }
  };

  visit(root, undefined);
  return refs;
}
