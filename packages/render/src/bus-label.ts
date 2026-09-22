interface Point { x: number; y: number }
export interface LabelRect { x: number; y: number; w: number; h: number }
export interface BusLabelPosition extends Point {
  vertical: boolean;
  /** Positive places text above a horizontal wire or right of a vertical wire. */
  side?: 1 | -1;
}

export function busLabelTextPosition(point: BusLabelPosition): Point & { anchor: "start" | "end" } {
  const side = point.side ?? 1;
  return {
    x: point.x + (point.vertical ? side * 10 : 10),
    y: point.y + (point.vertical ? 4 : side === 1 ? -10 : 21),
    anchor: point.vertical && side === -1 ? "end" : "start",
  };
}

export function busLabelBounds(point: BusLabelPosition, width: number | string): LabelRect {
  const text = busLabelTextPosition(point);
  const w = String(width).length * 8 + 8;
  return { x: text.x - (text.anchor === "end" ? w - 4 : 4), y: text.y - 15, w, h: 21 };
}

export function busMarkerBounds(point: BusLabelPosition, width: number | string): LabelRect {
  const label = busLabelBounds(point, width);
  const x = Math.min(point.x - 7, label.x);
  const y = Math.min(point.y - 8, label.y);
  return { x, y, w: Math.max(point.x + 7, label.x + label.w) - x, h: Math.max(point.y + 8, label.y + label.h) - y };
}

/* Every route of a net carries a width marker, and the routes of a fan-out all
 * begin at the same pin, so their markers land on the shared trunk within a
 * few tens of pixels of each other and repeat the same number. Branches that
 * have actually separated sit much further apart than this. */
export const BUS_MARKER_SPACING = 120;

export function crowdedByMarker(point: Point, placed: Point[], spacing = BUS_MARKER_SPACING): boolean {
  return placed.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < spacing);
}

export function wireClearances(paths: { points: Point[] }[]): LabelRect[] {
  return paths.flatMap(path => path.points.slice(1).map((b, i) => {
    const a = path.points[i];
    return { x: Math.min(a.x, b.x) - 3, y: Math.min(a.y, b.y) - 3,
      w: Math.abs(b.x - a.x) + 6, h: Math.abs(b.y - a.y) + 6 };
  }));
}

function overlaps(a: LabelRect, b: LabelRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Keep the whole marker clear of other labels, and its text clear of every routed wire. */
export function busLabelPosition(points: Point[], width: number | string, occupied: LabelRect[] = [], wires: LabelRect[] = []): BusLabelPosition | undefined {
  // the single bit rule is about bus widths; a value is always worth placing
  if (typeof width === "number" && width <= 1) return undefined;
  const segments = points.slice(1).flatMap((b, index) => {
    const a = points[index];
    const vertical = Math.abs(a.x - b.x) < 0.5;
    const horizontal = Math.abs(a.y - b.y) < 0.5;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if ((!vertical && !horizontal) || length < String(width).length * 8 + 48) return [];
    return [{ a, b, vertical, length }];
  });
  segments.sort((a, b) => Number(a.vertical) - Number(b.vertical) || b.length - a.length);
  for (const segment of segments) {
    for (const t of [0.5, 0.25, 0.75, 0.125, 0.875]) {
      for (const side of [1, -1] as const) {
        const point = { x: segment.a.x + (segment.b.x - segment.a.x) * t,
          y: segment.a.y + (segment.b.y - segment.a.y) * t, vertical: segment.vertical, side };
        const marker = busMarkerBounds(point, width);
        const label = busLabelBounds(point, width);
        if (occupied.some(r => overlaps(marker, r)) || wires.some(r => overlaps(label, r))) continue;
        return point;
      }
    }
  }
  return undefined;
}
