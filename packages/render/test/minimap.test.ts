import { expect, it } from "vitest";
import type { CanvasScene } from "../src/canvas.js";
import { minimapRecenter, minimapScene, minimapSize, minimapTransform, minimapViewport } from "../src/minimap-geometry.js";

it("includes nested components at absolute positions and routes beyond the outer boxes", () => {
  const child = { key: "leaf", id: { path: [], irId: "leaf" }, kind: "primitive" as const,
    title: "leaf", x: 30, y: 40, w: 20, h: 10, pins: [] };
  const scene: CanvasScene = {
    nodes: [{ ...child, key: "box", kind: "always", x: 100, y: -200, w: 200, h: 100, children: [child] }],
    wires: [{ key: "feedback", points: [{ x: -80, y: -300 }, { x: 400, y: 20 }] }], collapsed: [],
  };
  const overview = minimapScene(scene);
  expect(overview.nodes[1]).toMatchObject({ x: 130, y: -160, compound: false });
  expect(overview.nodes[0].compound).toBe(true);
  expect(overview.bounds).toEqual({ minX: -80, minY: -300, maxX: 400, maxY: 20 });
});

it("caps the full panel to 30% of the viewport and keeps it within narrow or short viewports", () => {
  for (const viewport of [{ width: 1000, height: 600 }, { width: 180, height: 800 },
    { width: 1400, height: 100 }, { width: 90, height: 60 }, { width: 0, height: 0 }]) {
    const size = minimapSize(10000, viewport);
    expect(size.width * size.height).toBeLessThanOrEqual(viewport.width * viewport.height * 0.3 + 1e-8);
    expect(size.width).toBeLessThanOrEqual(Math.max(0, viewport.width - 24));
    expect(size.height).toBeLessThanOrEqual(Math.max(0, viewport.height - 24) + 1e-8);
  }
  expect(minimapSize(220, { width: 1000, height: 600 })).toEqual({ width: 220, height: 140 });
});

it("centers the overview with padding without distorting long schematics", () => {
  const bounds = { minX: -1000, minY: 50, maxX: 3000, maxY: 150 };
  const map = minimapTransform(bounds, { width: 220, height: 116 });
  expect(map.x + bounds.minX * map.k).toBeCloseTo(8);
  expect(map.x + bounds.maxX * map.k).toBeCloseTo(212);
  expect(map.y + 100 * map.k).toBeCloseTo(58);
});

it("maps the viewport correctly and recenters to the clicked point without changing zoom", () => {
  const size = { width: 1000, height: 600 };
  const map = { x: 10, y: 20, k: 0.1 };
  for (const k of [0.05, 0.6, 1, 4]) {
    const camera = { x: -250, y: 80, k };
    const box = minimapViewport(camera, size, map);
    expect(box.x).toBeCloseTo(10 + 250 / k * 0.1);
    expect(box.y).toBeCloseTo(20 - 80 / k * 0.1);
    expect(box.width).toBeCloseTo(1000 / k * 0.1);
    const centered = minimapRecenter({ x: 90, y: 65 }, map, camera, size);
    expect(centered.k).toBe(k);
    const next = minimapViewport(centered, size, map);
    expect(next.x + next.width / 2).toBeCloseTo(90);
    expect(next.y + next.height / 2).toBeCloseTo(65);
  }
});

it("has finite transforms for empty scenes and point-sized bounds", () => {
  const empty = minimapScene({ nodes: [], wires: [], collapsed: [] });
  expect(empty.nodes).toEqual([]);
  for (const bounds of [empty.bounds, { minX: 12, minY: 34, maxX: 12, maxY: 34 }]) {
    expect(Object.values(minimapTransform(bounds, { width: 220, height: 116 })).every(Number.isFinite)).toBe(true);
  }
});
