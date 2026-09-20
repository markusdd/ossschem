import type { Camera, CanvasScene } from "./canvas.js";
import type { Bounds } from "./focus.js";

export interface Size { width: number; height: number }
export interface MapNode { x: number; y: number; w: number; h: number; kind: string; compound: boolean }

/** Collect absolute positions once per layout, including routes outside node bounds. */
export function minimapScene(scene: CanvasScene): { nodes: MapNode[]; bounds: Bounds } {
  const nodes: MapNode[] = [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number): void => {
    bounds.minX = Math.min(bounds.minX, x); bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x); bounds.maxY = Math.max(bounds.maxY, y);
  };
  const visit = (list: CanvasScene["nodes"], ox = 0, oy = 0): void => {
    for (const n of list) {
      const x = ox + n.x, y = oy + n.y;
      nodes.push({ x, y, w: n.w, h: n.h, kind: n.kind, compound: !!n.children?.length });
      add(x, y); add(x + n.w, y + n.h);
      visit(n.children ?? [], x, y);
    }
  };
  visit(scene.nodes);
  for (const wire of scene.wires) for (const p of wire.points) add(p.x, p.y);
  if (!Number.isFinite(bounds.minX)) return { nodes, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
  return { nodes, bounds };
}

/** Fixed aspect ratio; the entire panel occupies at most 30% of the viewport area. */
export function minimapSize(preferredWidth: number, viewport: Size): Size {
  const ratio = 220 / 140;
  const maxWidth = Math.min(Math.max(0, viewport.width - 24), Math.max(0, viewport.height - 24) * ratio,
    Math.sqrt(Math.max(0, viewport.width * viewport.height) * 0.3 * ratio));
  const width = Math.min(Math.max(160, preferredWidth), maxWidth);
  return { width, height: width / ratio };
}

export function minimapTransform(bounds: Bounds, size: Size): Camera {
  const k = Math.max(0.000001, Math.min(Math.max(1, size.width - 16) / Math.max(1, bounds.maxX - bounds.minX),
    Math.max(1, size.height - 16) / Math.max(1, bounds.maxY - bounds.minY)));
  return { k, x: size.width / 2 - (bounds.minX + bounds.maxX) * k / 2,
    y: size.height / 2 - (bounds.minY + bounds.maxY) * k / 2 };
}

export function minimapViewport(camera: Camera, viewport: Size, map: Camera) {
  return { x: map.x - camera.x / camera.k * map.k, y: map.y - camera.y / camera.k * map.k,
    width: viewport.width / camera.k * map.k, height: viewport.height / camera.k * map.k };
}

export function minimapRecenter(point: { x: number; y: number }, map: Camera, camera: Camera, viewport: Size): Camera {
  return { k: camera.k, x: viewport.width / 2 - (point.x - map.x) / map.k * camera.k,
    y: viewport.height / 2 - (point.y - map.y) / map.k * camera.k };
}
