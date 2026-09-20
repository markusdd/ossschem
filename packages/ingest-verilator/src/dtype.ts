import { resolveAddr } from "./addr.js";
import type { ResolvedDtype, VerilatorNode, Width } from "./types.js";

function parseColonRange(range: string): Width {
  const match = /^(-?\d+):(-?\d+)$/.exec(range);
  if (match === null) {
    throw new Error(`invalid dtype range: ${JSON.stringify(range)}`);
  }
  return { msb: Number(match[1]), lsb: Number(match[2]), packed: true };
}

/** Scalar (no `range`) and `"0:0"` are both 1-bit. */
export function widthFromRange(range: string | undefined): Width {
  if (range === undefined || range.length === 0 || range === "0:0") {
    return { msb: 0, lsb: 0, packed: true };
  }
  return parseColonRange(range);
}

function unpackedFromDeclRange(declRange: string | undefined): Width | undefined {
  if (declRange === undefined) {
    return undefined;
  }
  const match = /^\[(-?\d+):(-?\d+)\]$/.exec(declRange);
  if (match === null) {
    return undefined;
  }
  return { msb: Number(match[1]), lsb: Number(match[2]), packed: false };
}

function asRangeString(node: VerilatorNode): string | undefined {
  return typeof node.range === "string" ? node.range : undefined;
}

export function resolveDtype(
  byAddr: Map<string, VerilatorNode>,
  addr: string | undefined,
): ResolvedDtype | undefined {
  const node = resolveAddr(byAddr, addr);
  if (node === undefined || addr === undefined) {
    return undefined;
  }

  if (node.type === "BASICDTYPE") {
    return {
      addr,
      kind: "basic",
      keyword: typeof node.keyword === "string" ? node.keyword : node.name,
      width: widthFromRange(asRangeString(node)),
    };
  }

  if (node.type === "UNPACKARRAYDTYPE") {
    const element = resolveDtype(
      byAddr,
      typeof node.refDTypep === "string" ? node.refDTypep : undefined,
    );
    const declRange = typeof node.declRange === "string" ? node.declRange : undefined;
    return {
      addr,
      kind: "unpackArray",
      keyword: element?.keyword,
      width: element?.width ?? { msb: 0, lsb: 0, packed: true },
      unpacked: unpackedFromDeclRange(declRange),
    };
  }

  return {
    addr,
    kind: "unknown",
    keyword: node.type,
    width: widthFromRange(asRangeString(node)),
  };
}
