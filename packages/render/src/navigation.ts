import type { Camera } from "./canvas.js";

export interface ScreenPoint { x: number; y: number }

/** Frame a rectangle in viewport coordinates, regardless of drag direction or current pan. */
export function rectangleZoomCamera(start: ScreenPoint, end: ScreenPoint, camera: Camera, viewport: { width: number; height: number }): Camera | undefined {
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < 8 || height < 8 || viewport.width < 16 || viewport.height < 16) return undefined;
  const cx = ((start.x + end.x) / 2 - camera.x) / camera.k;
  const cy = ((start.y + end.y) / 2 - camera.y) / camera.k;
  const k = Math.min(8, Math.max(0.05, camera.k * Math.min(viewport.width / width, viewport.height / height)));
  return { k, x: viewport.width / 2 - cx * k, y: viewport.height / 2 - cy * k };
}
