import { expect, it } from "vitest";
import type { Level0Node } from "@ossschem/graph";
import { elementBounds, focusCamera, traceFocusKeys } from "../src/focus.js";

const gate: Level0Node = { key: "gate", id: { path: [], irId: "gate" }, kind: "primitive", title: "DFF",
  x: 200, y: 80, w: 100, h: 100, pins: [{ id: "gate::D", name: "D", side: "W", x: 0, y: 40, netId: "d", netName: "d" }] };
const container: Level0Node = { key: "process", id: { path: [], irId: "process" }, kind: "always", title: "always",
  x: 100, y: 200, w: 4000, h: 3000, children: [gate],
  pins: [{ id: "process::input", name: "input", side: "W", x: 0, y: 120, netId: "d", netName: "d" }] };
const wire = { key: "wire", points: [{ x: 100, y: 320 }, { x: 300, y: 320 }] };

it("frames the trace start and destination without fitting the surrounding process", () => {
  const keys = traceFocusKeys([container], [container.key, "process::input", gate.key, "gate::D", wire.key]);
  expect(keys).not.toContain(container.key);
  const bounds = elementBounds([container], [wire], keys)!;
  expect(bounds.minX).toBeLessThanOrEqual(100);
  expect(bounds.maxX).toBe(400);
  expect(bounds.maxY).toBe(380);
  const camera = focusCamera(bounds, { width: 900, height: 600 }, 1.2);
  expect(camera.k).toBeGreaterThanOrEqual(1.2);
  for (const point of [{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }]) {
    expect(camera.x + point.x * camera.k).toBeGreaterThanOrEqual(48);
    expect(camera.x + point.x * camera.k).toBeLessThanOrEqual(852);
    expect(camera.y + point.y * camera.k).toBeGreaterThanOrEqual(48);
    expect(camera.y + point.y * camera.k).toBeLessThanOrEqual(552);
  }
});

it("preserves a close zoom when the local trace fits and includes context for small targets", () => {
  const camera = focusCamera({ minX: 100, minY: 100, maxX: 200, maxY: 200 }, { width: 900, height: 600 }, 3);
  expect(camera.k).toBe(3);
  expect(focusCamera({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, { width: 900, height: 600 }, 1).k).toBe(1.6);
});

it("recenters without forcing a zoom-in from an overview", () => {
  const camera = focusCamera({ minX: 100, minY: 100, maxX: 200, maxY: 200 }, { width: 900, height: 600 }, 0.6);
  expect(camera.k).toBe(0.6);
  expect(camera.x + 150 * camera.k).toBeCloseTo(450);
  expect(camera.y + 150 * camera.k).toBeCloseTo(300);
});

it("can still frame a whole container for explicit expansion or ignore missing selections", () => {
  expect(elementBounds([container], [], [container.key])!.maxX).toBe(4100);
  expect(elementBounds([container], [], ["missing"])).toBeUndefined();
});
