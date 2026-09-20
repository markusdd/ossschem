import { expect, it } from "vitest";
import { rectangleZoomCamera } from "../src/navigation.js";

it("fits the dragged world region after panning and zooming, in any drag direction", () => {
  const previous = { x: -250, y: 75, k: 0.4 };
  const viewport = { width: 1000, height: 600 };
  const corners = [{ x: 200, y: 150 }, { x: 600, y: 350 }];
  const result = rectangleZoomCamera(corners[0], corners[1], previous, viewport)!;
  expect(result).toEqual(rectangleZoomCamera(corners[1], corners[0], previous, viewport));
  expect(result).toEqual(rectangleZoomCamera({ x: 200, y: 350 }, { x: 600, y: 150 }, previous, viewport));
  expect(result.k).toBeGreaterThan(previous.k);
  const positions = corners.map(p => ({
    x: result.x + (p.x - previous.x) / previous.k * result.k,
    y: result.y + (p.y - previous.y) / previous.k * result.k,
  }));
  expect((positions[0].x + positions[1].x) / 2).toBeCloseTo(viewport.width / 2);
  expect((positions[0].y + positions[1].y) / 2).toBeCloseTo(viewport.height / 2);
  for (const p of positions) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(viewport.width);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(viewport.height);
  }
});

it("ignores click jitter and degenerate rectangles, and caps maximum magnification", () => {
  const camera = { x: 0, y: 0, k: 1 };
  const viewport = { width: 1000, height: 600 };
  for (const end of [{ x: 3, y: 3 }, { x: 200, y: 0 }, { x: 0, y: 200 }]) {
    expect(rectangleZoomCamera({ x: 0, y: 0 }, end, camera, viewport)).toBeUndefined();
  }
  expect(rectangleZoomCamera({ x: 0, y: 0 }, { x: 10, y: 10 }, camera, viewport)!.k).toBe(8);
});
