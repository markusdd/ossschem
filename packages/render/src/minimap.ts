import type { Camera, CanvasController } from "./canvas.js";
import { minimapRecenter, minimapScene, minimapSize, minimapTransform, minimapViewport, type Size } from "./minimap-geometry.js";

const SIZE_KEY = "ossschem.world-map-width";

function loadWidth(): number {
  try {
    const width = Number(localStorage.getItem(SIZE_KEY));
    if (Number.isFinite(width) && width >= 160) return width;
  } catch { /* Storage is optional. */ }
  return 220;
}

/** One cached bitmap per scene/size/theme change, plus a cheap viewport overlay. */
export function attachMinimap(host: HTMLElement, controller: CanvasController) {
  const panel = document.createElement("section");
  panel.className = "ossschem-minimap";
  panel.setAttribute("aria-label", "World map");
  const header = document.createElement("div");
  header.className = "ossschem-minimap-header";
  header.textContent = "World map";
  const resize = document.createElement("button");
  resize.type = "button";
  resize.className = "ossschem-minimap-resize";
  resize.textContent = "⤡";
  resize.setAttribute("aria-label", "Resize world map");
  resize.title = "Drag the upper-left corner to resize. Arrow keys adjust size; Enter resets.";
  header.prepend(resize);
  const surface = document.createElement("div");
  surface.className = "ossschem-minimap-surface";
  surface.tabIndex = 0;
  surface.setAttribute("role", "group");
  surface.setAttribute("aria-label", "Schematic overview: click to center, drag to pan, or use arrow keys");
  surface.title = "Click to center · drag the view box to pan · arrow keys to pan";
  const bitmap = document.createElement("canvas");
  bitmap.setAttribute("aria-hidden", "true");
  const frame = document.createElement("div");
  frame.className = "ossschem-minimap-viewport";
  frame.setAttribute("aria-hidden", "true");
  surface.append(bitmap, frame);
  panel.append(header, surface);
  host.append(panel);

  let scene = controller.scene();
  let overview = minimapScene(scene);
  let viewport: Size = { width: host.clientWidth, height: host.clientHeight };
  let preferredWidth = loadWidth();
  let size = minimapSize(preferredWidth, viewport);
  let map: Camera = { x: 0, y: 0, k: 1 };
  let dirty = true;
  let pendingScene = false;
  let raf = 0;
  let pendingCamera: Camera | null = null;
  let drag: { pointer: number; x: number; y: number; camera: Camera; mapScale: number } | null = null;
  let sizing: { pointer: number; x: number; y: number; width: number } | null = null;

  const saveWidth = (): void => {
    try { localStorage.setItem(SIZE_KEY, String(preferredWidth)); } catch { /* Storage is optional. */ }
  };
  const schedule = (): void => { if (!raf) raf = requestAnimationFrame(paint); };
  const setSize = (): void => {
    size = minimapSize(preferredWidth, viewport);
    panel.style.width = `${size.width}px`;
    panel.style.height = `${size.height}px`;
    panel.hidden = size.width < 80 || size.height < 48;
    dirty = true;
    schedule();
  };
  const finishDrag = (): void => {
    const pointer = drag?.pointer;
    drag = null;
    surface.classList.remove("is-dragging");
    if (pointer !== undefined && surface.hasPointerCapture(pointer)) surface.releasePointerCapture(pointer);
  };
  const finishResize = (): void => {
    const pointer = sizing?.pointer;
    if (!sizing) return;
    sizing = null;
    saveWidth();
    if (pointer !== undefined && resize.hasPointerCapture(pointer)) resize.releasePointerCapture(pointer);
  };
  function paint(): void {
    // Keep raf set while panTo notifies subscribers, avoiding a redundant frame.
    if (pendingCamera) {
      controller.panTo(pendingCamera.x, pendingCamera.y);
      pendingCamera = null;
    }
    if (pendingScene) {
      scene = controller.scene();
      overview = minimapScene(scene);
      pendingScene = false;
    }
    const contentSize = { width: size.width, height: Math.max(1, size.height - 24) };
    if (dirty && !panel.hidden) {
      map = minimapTransform(overview.bounds, contentSize);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      bitmap.width = Math.max(1, Math.round(contentSize.width * dpr));
      bitmap.height = Math.max(1, Math.round(contentSize.height * dpr));
      const ctx = bitmap.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const css = getComputedStyle(panel);
        const color = (name: string): string => css.getPropertyValue(name).trim();
        ctx.fillStyle = color("--canvas");
        ctx.fillRect(0, 0, contentSize.width, contentSize.height);
        ctx.strokeStyle = color("--fg-muted");
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (const wire of scene.wires) wire.points.forEach((p, i) => {
          const x = map.x + p.x * map.k, y = map.y + p.y * map.k;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        const colors: Record<string, string> = {
          port: color("--port-color"), always: color("--process-color"), assign: color("--process-color"),
          instance: color("--instance-color"), instanceArray: color("--instance-color"), primitive: color("--logic-color"),
        };
        for (const node of overview.nodes) {
          const x = map.x + node.x * map.k, y = map.y + node.y * map.k;
          const w = Math.max(1, node.w * map.k), h = Math.max(1, node.h * map.k);
          ctx.fillStyle = ctx.strokeStyle = colors[node.kind] ?? color("--fg-muted");
          ctx.globalAlpha = node.compound ? 0.08 : 0.65;
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = 0.8;
          ctx.strokeRect(x, y, w, h);
        }
      }
      dirty = false;
    }
    const view = minimapViewport(controller.camera(), viewport, map);
    frame.hidden = overview.nodes.length === 0;
    frame.style.transform = `translate(${view.x}px, ${view.y}px)`;
    frame.style.width = `${view.width}px`;
    frame.style.height = `${view.height}px`;
    raf = 0;
  }

  surface.addEventListener("pointerdown", ev => {
    if (ev.button !== 0 || drag || overview.nodes.length === 0) return;
    ev.preventDefault();
    surface.focus();
    const rect = surface.getBoundingClientRect();
    const point = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    let camera = controller.camera();
    const view = minimapViewport(camera, viewport, map);
    if (point.x < view.x || point.x > view.x + view.width || point.y < view.y || point.y > view.y + view.height) {
      camera = minimapRecenter(point, map, camera, viewport);
      pendingCamera = camera;
    }
    drag = { pointer: ev.pointerId, x: ev.clientX, y: ev.clientY, camera, mapScale: map.k };
    surface.setPointerCapture(ev.pointerId);
    surface.classList.add("is-dragging");
    schedule();
  });
  const move = (ev: PointerEvent): void => {
    if (drag?.pointer !== ev.pointerId) return;
    pendingCamera = { ...drag.camera,
      x: drag.camera.x - (ev.clientX - drag.x) / drag.mapScale * drag.camera.k,
      y: drag.camera.y - (ev.clientY - drag.y) / drag.mapScale * drag.camera.k };
    schedule();
  };
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerup", ev => { move(ev); finishDrag(); });
  surface.addEventListener("pointercancel", finishDrag);
  surface.addEventListener("lostpointercapture", finishDrag);
  surface.addEventListener("keydown", ev => {
    const camera = controller.camera();
    const step = ev.shiftKey ? 120 : 40;
    if (ev.key === "ArrowLeft") controller.panTo(camera.x + step, camera.y);
    else if (ev.key === "ArrowRight") controller.panTo(camera.x - step, camera.y);
    else if (ev.key === "ArrowUp") controller.panTo(camera.x, camera.y + step);
    else if (ev.key === "ArrowDown") controller.panTo(camera.x, camera.y - step);
    else return;
    ev.preventDefault(); ev.stopPropagation();
  });
  resize.addEventListener("pointerdown", ev => {
    if (ev.button !== 0 || sizing) return;
    ev.preventDefault(); resize.focus();
    sizing = { pointer: ev.pointerId, x: ev.clientX, y: ev.clientY, width: size.width };
    resize.setPointerCapture(ev.pointerId);
  });
  resize.addEventListener("pointermove", ev => {
    if (sizing?.pointer !== ev.pointerId) return;
    // Project the drag onto the fixed-aspect diagonal, anchored at bottom right.
    const ratio = 140 / 220;
    const width = sizing.width + ((sizing.x - ev.clientX) + ratio * (sizing.y - ev.clientY)) / (1 + ratio * ratio);
    preferredWidth = minimapSize(width, viewport).width;
    setSize();
  });
  resize.addEventListener("pointerup", finishResize);
  resize.addEventListener("pointercancel", finishResize);
  resize.addEventListener("lostpointercapture", finishResize);
  resize.addEventListener("dblclick", () => { preferredWidth = 220; setSize(); saveWidth(); });
  resize.addEventListener("keydown", ev => {
    const step = ev.shiftKey ? 40 : 10;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") preferredWidth = minimapSize(size.width + step, viewport).width;
    else if (ev.key === "ArrowRight" || ev.key === "ArrowDown") preferredWidth = minimapSize(size.width - step, viewport).width;
    else if (ev.key === "Enter" || ev.key === "Home") preferredWidth = 220;
    else return;
    ev.preventDefault(); ev.stopPropagation(); setSize(); saveWidth();
  });
  const observer = new ResizeObserver(() => {
    viewport = { width: host.clientWidth, height: host.clientHeight };
    finishDrag(); finishResize();
    setSize();
  });
  observer.observe(host);
  const unsubscribe = controller.subscribe(change => {
    if (change === "scene") { finishDrag(); pendingCamera = null; pendingScene = true; dirty = true; }
    schedule();
  });
  setSize();
  return {
    refreshTheme() { dirty = true; schedule(); },
    destroy() {
      finishDrag(); finishResize();
      observer.disconnect(); unsubscribe(); cancelAnimationFrame(raf); panel.remove();
    },
  };
}
