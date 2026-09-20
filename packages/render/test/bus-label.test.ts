import { expect, it } from "vitest";
import { busLabelBounds, busMarkerBounds, busLabelPosition, wireClearances } from "../src/bus-label.js";

it("labels buses while leaving scalar and very short wires uncluttered", () => {
  const route = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
  expect(busLabelPosition(route, 1)).toBeUndefined();
  expect(busLabelPosition(route, 32)).toBeDefined();
  expect(busLabelPosition([{ x: 0, y: 0 }, { x: 12, y: 0 }], 32)).toBeUndefined();
});

it("moves a width label away from component labels or omits it when no clear space exists", () => {
  const route = [{ x: 0, y: 50 }, { x: 400, y: 50 }];
  const middle = busLabelPosition(route, 32)!;
  const moved = busLabelPosition(route, 32, [busLabelBounds(middle, 32)])!;
  expect(moved.x !== middle.x || moved.side !== middle.side).toBe(true);
  expect(busLabelPosition(route, 32, [{ x: 0, y: 0, w: 500, h: 100 }])).toBeUndefined();
});

function intersects(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

it("keeps width text off neighboring horizontal wires and reserves the slash too", () => {
  const paths = [0, 28, 56].map(y => ({ points: [{ x: 0, y }, { x: 400, y }] }));
  const wires = wireClearances(paths);
  const occupied: ReturnType<typeof busMarkerBounds>[] = [];
  for (const path of paths) {
    const label = busLabelPosition(path.points, 32, occupied, wires)!;
    expect(label).toBeDefined();
    expect(wires.some(w => intersects(busLabelBounds(label, 32), w))).toBe(false);
    const marker = busMarkerBounds(label, 32);
    expect(occupied.some(r => intersects(marker, r))).toBe(false);
    occupied.push(marker);
  }
});

it("can put text on the other side of closely spaced vertical wires", () => {
  const paths = [0, 12].map(x => ({ points: [{ x, y: 0 }, { x, y: 300 }] }));
  const wires = wireClearances(paths);
  const first = busLabelPosition(paths[0].points, 32, [], wires)!;
  expect(first.side).toBe(-1);
  const second = busLabelPosition(paths[1].points, 32, [busMarkerBounds(first, 32)], wires)!;
  expect(second).toBeDefined();
  expect(wires.some(w => intersects(busLabelBounds(second, 32), w))).toBe(false);
});
