import { UNLINKED, type DanglingPtr, type VerilatorNode } from "./types.js";
import { walkNodes } from "./walk.js";

export function indexByAddr(root: unknown): Map<string, VerilatorNode> {
  const byAddr = new Map<string, VerilatorNode>();
  walkNodes(root, (node) => {
    if (typeof node.addr === "string" && node.addr.length > 0) {
      byAddr.set(node.addr, node);
    }
  });
  return byAddr;
}

export function resolveAddr(
  byAddr: Map<string, VerilatorNode>,
  addr: string | undefined,
): VerilatorNode | undefined {
  if (addr === undefined || addr === UNLINKED || addr.length === 0) {
    return undefined;
  }
  return byAddr.get(addr);
}

export function danglingPointers(
  root: unknown,
  byAddr: Map<string, VerilatorNode>,
  fields: readonly string[],
): DanglingPtr[] {
  const found: DanglingPtr[] = [];
  walkNodes(root, (node) => {
    for (const field of fields) {
      const raw = node[field];
      if (typeof raw !== "string" || raw.length === 0 || raw === UNLINKED) {
        continue;
      }
      if (!byAddr.has(raw)) {
        found.push({ field, addr: raw, nodeType: node.type, name: node.name });
      }
    }
  });
  return found;
}
