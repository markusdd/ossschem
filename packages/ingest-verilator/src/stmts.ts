import type { VerilatorNode } from "./types.js";

export function child(node: VerilatorNode, field: string): VerilatorNode | undefined {
  return asNodes(node[field])[0];
}

export function asNodes(value: unknown): VerilatorNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (n): n is VerilatorNode =>
      typeof n === "object" && n !== null && typeof (n as VerilatorNode).type === "string",
  );
}

const GENBLK = /^genblk\d+$/;

export function skipGenblock(block: VerilatorNode): boolean {
  if (block.implied === true) {
    return true;
  }
  return asNodes(block.itemsp).length === 0;
}

export function liftGenblock(block: VerilatorNode): boolean {
  return block.unnamed === true || (typeof block.name === "string" && GENBLK.test(block.name));
}

/** Lift unnamed/genblkN, skip empty/implied wrappers, recurse generate. */
export function forEachLiftedStmt(
  stmts: VerilatorNode[],
  visit: (stmt: VerilatorNode) => void,
): void {
  for (const stmt of stmts) {
    if (stmt.type === "GENBLOCK") {
      if (skipGenblock(stmt)) {
        continue;
      }
      forEachLiftedStmt(asNodes(stmt.itemsp), visit);
      continue;
    }
    visit(stmt);
  }
}
