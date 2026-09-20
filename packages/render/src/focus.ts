import { pinLabel, type Level0Node } from "@ossschem/graph";

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
interface FocusWire { key: string; points: { x: number; y: number }[] }

/** Pins identify a point on an expanded boundary, not the bounds of its entire container. */
export function elementBounds(nodes: Level0Node[], wires: FocusWire[], keys: readonly string[]): Bounds | undefined {
  const selected = new Set(keys);
  const result = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number): void => {
    result.minX = Math.min(result.minX, x); result.minY = Math.min(result.minY, y);
    result.maxX = Math.max(result.maxX, x); result.maxY = Math.max(result.maxY, y);
  };
  const visit = (list: Level0Node[], ox = 0, oy = 0): void => {
    for (const n of list) {
      const x = ox + n.x, y = oy + n.y;
      if (selected.has(n.key)) { add(x, y); add(x + n.w, y + n.h); }
      for (const p of n.pins) if (selected.has(p.id)) {
        if (n.kind === "port") { add(x, y); add(x + n.w, y + n.h); continue; }
        const px = x + (p.x ?? (p.side === "W" ? 0 : n.w));
        const py = y + (p.y ?? n.h / 2);
        add(px - 16, py - 24); add(px + 16, py + 12);
        if (n.kind !== "primitive") {
          const labelWidth = pinLabel(p).length * 7;
          const labelX = x + (p.side === "W" ? 20 : n.w - 20 - labelWidth);
          add(labelX, py - 24); add(labelX + labelWidth, py + 12);
        }
      }
      visit(n.children ?? [], x, y);
    }
  };
  visit(nodes);
  for (const wire of wires) if (selected.has(wire.key)) for (const point of wire.points) add(point.x, point.y);
  return Number.isFinite(result.minX) ? result : undefined;
}

/** Remove enclosing containers from a trace, while keeping the reached pins and leaf components. */
export function traceFocusKeys(nodes: Level0Node[], keys: readonly string[]): string[] {
  const containers = new Set<string>();
  const visit = (list: Level0Node[]): void => {
    for (const n of list) { if (n.children?.length) containers.add(n.key); visit(n.children ?? []); }
  };
  visit(nodes);
  return keys.filter(key => !containers.has(key));
}

export function focusCamera(bounds: Bounds, viewport: { width: number; height: number }, currentScale: number) {
  const padding = 48;
  const width = Math.max(80, bounds.maxX - bounds.minX);
  const height = Math.max(60, bounds.maxY - bounds.minY);
  // Keep the close framing used during normal tracing, but do not force a
  // zoom-in after the user has deliberately backed out to an overview.
  const targetScale = currentScale < 1 ? currentScale : Math.max(1.6, currentScale);
  const k = Math.max(0.05, Math.min((viewport.width - padding * 2) / width,
    (viewport.height - padding * 2) / height, targetScale));
  return { k, x: viewport.width / 2 - k * (bounds.minX + bounds.maxX) / 2,
    y: viewport.height / 2 - k * (bounds.minY + bounds.maxY) / 2 };
}
