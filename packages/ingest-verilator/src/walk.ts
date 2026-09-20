import type { VerilatorNode } from "./types.js";

export function isNode(value: unknown): value is VerilatorNode {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** Depth-first walk of AST objects. String pointer fields are not nodes. */
export function walkNodes(root: unknown, visit: (node: VerilatorNode) => void): void {
  const seen = new Set<object>();

  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) {
        walk(child);
      }
      return;
    }
    if (isNode(value)) {
      visit(value);
    }
    for (const child of Object.values(value)) {
      walk(child);
    }
  };

  walk(root);
}
