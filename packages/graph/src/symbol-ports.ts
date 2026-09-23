import type { Level0Node, Pin } from "./level0.js";

export const SYMBOL_VB = { w: 80, h: 64 };

/** Letterbox a 80×64 viewBox into the node (same as SVG `xMidYMid meet`). */
export function symbolContentBox(w: number, h: number): { ox: number; oy: number; scale: number } {
  const scale = Math.min(w / SYMBOL_VB.w, h / SYMBOL_VB.h);
  return {
    scale,
    ox: (w - SYMBOL_VB.w * scale) / 2,
    oy: (h - SYMBOL_VB.h * scale) / 2,
  };
}

export function mapSymbolPoint(vx: number, vy: number, w: number, h: number): { x: number; y: number } {
  const { ox, oy, scale } = symbolContentBox(w, h);
  return { x: ox + vx * scale, y: oy + vy * scale };
}

/** Present inputs share a uniform pitch; clock remains at the lower-left corner. */
export function flipFlopPorts(kind: string): Record<string, { vx: number; vy: number }> {
  const reset = kind === "adff" || kind === "adffe";
  const enable = kind === "dffe" || kind === "adffe";
  const inputs = [...(reset ? ["ARST"] : []), "D", ...(enable ? ["EN"] : []), "CLK"];
  const top = reset ? 16 : enable ? 24 : 28;
  const pitch = (52 - top) / (inputs.length - 1);
  const pins = Object.fromEntries(inputs.map((name, i) => [name, { vx: 18, vy: top + pitch * i }]));
  return { ...pins, Q: { vx: 62, vy: pins.D.vy } };
}

const PORTS: Record<string, Record<string, { vx: number; vy: number }>> = {
  not: { A: { vx: 8, vy: 32 }, Y: { vx: 64, vy: 32 } },
  buf: { A: { vx: 8, vy: 32 }, Y: { vx: 58, vy: 32 } },
  and: { A: { vx: 8, vy: 22 }, B: { vx: 8, vy: 42 }, Y: { vx: 64, vy: 32 } },
  or: { A: { vx: 8, vy: 22 }, B: { vx: 8, vy: 42 }, Y: { vx: 62, vy: 32 } },
  xor: { A: { vx: 12, vy: 22 }, B: { vx: 12, vy: 42 }, Y: { vx: 64, vy: 32 } },
  mux: { A: { vx: 22, vy: 20 }, B: { vx: 22, vy: 44 }, S: { vx: 22, vy: 32 }, Y: { vx: 58, vy: 32 } },
  add: { A: { vx: 16, vy: 24 }, B: { vx: 16, vy: 40 }, Y: { vx: 64, vy: 32 } },
  sub: { A: { vx: 16, vy: 24 }, B: { vx: 16, vy: 40 }, Y: { vx: 64, vy: 32 } },
  eq: { A: { vx: 16, vy: 24 }, B: { vx: 16, vy: 40 }, Y: { vx: 64, vy: 32 } },
  shiftr: { A: { vx: 16, vy: 32 }, Y: { vx: 64, vy: 32 } },
  shiftl: { A: { vx: 16, vy: 32 }, Y: { vx: 64, vy: 32 } },
  slice: { A: { vx: 16, vy: 32 }, Y: { vx: 64, vy: 32 } },
  concat: { A0: { vx: 14, vy: 21 }, A1: { vx: 14, vy: 43 }, Y: { vx: 66, vy: 32 } },
  // the tag's point, where the wire leaves it
  const: { Y: { vx: 62, vy: 32 } },
  dff: flipFlopPorts("dff"),
  adff: flipFlopPorts("adff"),
  dffe: flipFlopPorts("dffe"),
  adffe: flipFlopPorts("adffe"),
  memrd: { MEM: { vx: 14, vy: 24 }, ADDR: { vx: 14, vy: 40 }, Y: { vx: 66, vy: 40 } },
  memwr: { D: { vx: 14, vy: 20 }, ADDR: { vx: 14, vy: 32 }, WE: { vx: 14, vy: 44 }, CLK: { vx: 14, vy: 52 }, Q: { vx: 66, vy: 40 } },
};

export function placeGatePins(n: Level0Node): Pin[] {
  const kind = n.symbol ?? "";
  const glyphHeight = n.symbolHeight ?? n.h;
  const west = n.pins.filter((p) => p.side === "W");
  const east = n.pins.filter((p) => p.side === "E");
  const fallbackY = (i: number, count: number): number => {
    if (count <= 1) {
      return glyphHeight / 2;
    }
    return glyphHeight * (0.32 + (0.36 * i) / (count - 1));
  };
  const at = (p: Pin, i: number, count: number, side: "W" | "E"): Pin => {
    const sp = PORTS[kind]?.[p.name];
    if (sp === undefined) {
      return { ...p, x: side === "W" ? 0 : n.w, y: fallbackY(i, count) };
    }
    const pos = mapSymbolPoint(sp.vx, sp.vy, n.w, glyphHeight);
    return { ...p, x: pos.x, y: pos.y };
  };
  return [...west.map((p, i) => at(p, i, west.length, "W")), ...east.map((p, i) => at(p, i, east.length, "E"))];
}

/** Axis-aligned only: H, then V, then H. Never a diagonal. */
export function orthogonalPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number }[] {
  if (Math.abs(a.y - b.y) < 0.5) {
    return [a, { x: b.x, y: a.y }];
  }
  if (Math.abs(a.x - b.x) < 0.5) {
    return [a, { x: a.x, y: b.y }];
  }
  const dx = b.x - a.x;
  const stub = Math.max(10, Math.min(22, Math.abs(dx) * 0.35));
  const midX = dx >= 0 ? a.x + stub : a.x - stub;
  return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, { x: b.x, y: b.y }];
}

export function orthogonalizePath(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 2) {
    return pts;
  }
  const out: { x: number; y: number }[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const hx = Math.abs(a.x - b.x) < 0.5;
    const hy = Math.abs(a.y - b.y) < 0.5;
    if (hx || hy) {
      out.push(b);
    } else {
      out.push({ x: b.x, y: a.y }, b);
    }
  }
  return out;
}
