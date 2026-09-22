import { isPortLike, mapSymbolPoint, pinLabel, pinTraceDirection, signalValueKey, type PinFace, type TraceDirection, type CollapsedNetView, type Level0Node, type Pin } from "@ossschem/graph";
import { busMarkerBounds, busLabelPosition, busLabelTextPosition, crowdedByMarker, wireClearances, type LabelRect } from "./bus-label.js";
import { elementBounds, focusCamera } from "./focus.js";
import { drawSymbol } from "./symbols.js";
import { portOutline } from "./port-shape.js";
import { splitOutline } from "./split-shape.js";
import { rectangleZoomCamera, type ScreenPoint } from "./navigation.js";

export interface Wire {
  key: string;
  sourcePin?: string;
  targetPin?: string;
  points: { x: number; y: number }[];
  netName?: string;
  netId?: string;
  width?: number;
  /** Shown in place of the width, for a connection the bit count does not describe. */
  widthText?: string;
  /** The array element this connection carries, which has a value of its own. */
  element?: number;
}

export interface Junction {
  x: number;
  y: number;
  netId?: string;
}

export interface CanvasScene {
  nodes: Level0Node[];
  wires: Wire[];
  collapsed: CollapsedNetView[];
  junctions?: Junction[];
}

const NS = "http://www.w3.org/2000/svg";

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface CanvasController {
  setNodes(nodes: Level0Node[]): void;
  setScene(scene: CanvasScene): void;
  setSelection(key: string | null): void;
  setAnnotate(values: Record<string, string>): void;
  /** Values at the cursor, keyed by net id; empty clears them. */
  setValues(values: Record<string, string>): void;
  setCone(keys: readonly string[], frontierKeys?: readonly string[]): void;
  onSelect: ((key: string | null) => void) | null;
  onDblClick: ((key: string) => void) | null;
  onTracePin: ((key: string, direction: TraceDirection, face?: PinFace) => void) | null;
  zoomToFit(keys?: readonly string[]): void;
  focusElements(keys: readonly string[]): void;
  camera(): Camera;
  scene(): CanvasScene;
  panTo(x: number, y: number): void;
  subscribe(listener: (change: "scene" | "camera") => void): () => void;
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

const controllers = new WeakMap<SVGSVGElement, CanvasController>();

function walkNodes(nodes: Level0Node[], fn: (n: Level0Node, ox: number, oy: number) => void, ox = 0, oy = 0): void {
  for (const n of nodes) {
    fn(n, ox, oy);
    if (n.children !== undefined) {
      walkNodes(n.children, fn, ox + n.x, oy + n.y);
    }
  }
}

function selectedNet(nodes: Level0Node[], selected: string | null): string | null {
  if (selected === null) {
    return null;
  }
  let found: string | null = null;
  walkNodes(nodes, (n) => {
    if (found !== null) {
      return;
    }
    const pin = n.pins.find((p) => p.id === selected);
    if (pin !== undefined) {
      found = pin.netId;
    }
  });
  return found;
}

type SvgWithCtl = SVGSVGElement & { __ossschemCtl?: CanvasController };

export function attachCanvas(svg: SVGSVGElement): CanvasController {
  const tagged = svg as SvgWithCtl;
  if (tagged.__ossschemCtl !== undefined) {
    return tagged.__ossschemCtl;
  }
  const existing = controllers.get(svg);
  if (existing !== undefined) {
    return existing;
  }
  svg.querySelector(".ossschem-canvas-placeholder")?.remove();

  const existingWorld = svg.querySelector("g.ossschem-world");
  const world =
    existingWorld instanceof SVGGElement
      ? existingWorld
      : svgEl("g", { class: "ossschem-world" });
  if (!(existingWorld instanceof SVGGElement)) {
    svg.appendChild(world);
  }

  let camera: Camera = { x: 0, y: 0, k: 1 };
  const listeners = new Set<(change: "scene" | "camera") => void>();
  let nodes: Level0Node[] = [];
  let wires: Wire[] = [];
  let junctions: Junction[] = [];
  /** Signal values at the cursor, by net, drawn on the wires. */
  let values: Record<string, string> = {};
  let collapsed: CollapsedNetView[] = [];
  let selected: string | null = null;
  let cone = new Set<string>();
  let frontier = new Set<string>();
  let annotate: Record<string, string> = {};
  let drag: { pointerId: number; px: number; py: number; cx: number; cy: number } | null = null;
  let zoomDrag: { pointerId: number; start: ScreenPoint; end: ScreenPoint; hit: Element | null; moved: boolean } | null = null;
  let spaceDown = false;
  let lastClick: { t: number; nodeKey: string } | null = null;

  const zoomRect = svgEl("rect", { class: "ossschem-zoom-rect", display: "none", "pointer-events": "none" });
  svg.appendChild(zoomRect);
  const screenPoint = (ev: PointerEvent): ScreenPoint => {
    const box = svg.getBoundingClientRect();
    return { x: Math.max(0, Math.min(box.width, ev.clientX - box.left)), y: Math.max(0, Math.min(box.height, ev.clientY - box.top)) };
  };
  const cancelGesture = (): void => {
    const pointerId = zoomDrag?.pointerId ?? drag?.pointerId;
    zoomDrag = null;
    drag = null;
    zoomRect.setAttribute("display", "none");
    svg.classList.remove("ossschem-zooming", "ossschem-panning");
    if (pointerId !== undefined && svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
  };

  const applyCam = (): void => {
    world.setAttribute("transform", `translate(${camera.x} ${camera.y}) scale(${camera.k})`);
    listeners.forEach(listener => listener("camera"));
  };

  const drawPin = (g: SVGGElement, n: Level0Node, p: Pin, netSel: string | null): void => {
    const px = p.x ?? (p.side === "W" ? 0 : n.w);
    const py = p.y ?? 24;
    const on = selected === p.id || (netSel !== null && p.netId === netSel);
    const expandable = ["always", "assign", "instance", "instanceArray"].includes(n.kind);
    const inward = p.side === "W" ? 1 : -1;
    for (const face of (expandable ? ["inside", "outside"] : ["outside"]) as PinFace[]) {
      const offset = inward * (face === "inside" ? 10 : -10);
      const direction = pinTraceDirection(p.side, face);
      const attrs = { "data-id": p.id, "data-face": face, "data-trace": direction };
      const hit = svgEl("rect", {
        class: "ossschem-pin-hit", x: String(px + offset - 9), y: String(py - 8),
        width: "18", height: "16", ...attrs,
      });
      const title = svgEl("title");
      title.textContent = `Double-click to reveal ${direction === "back" ? "drivers" : "loads"} ${face} ${n.title || n.symbol}`;
      hit.appendChild(title);
      g.appendChild(hit);
      if (p.handles?.[face] ?? true) {
        g.appendChild(svgEl("line", {
          x1: String(px), y1: String(py), x2: String(px + offset), y2: String(py),
          class: "ossschem-pin-lead",
        }));
        const handle = svgEl("rect", {
          class: `ossschem-pin${p.collapsed ? " ossschem-pin-stub" : ""}${on ? " ossschem-pin-on" : ""}`,
          x: String(px + offset - 5), y: String(py - 5), width: "10", height: "10", rx: "1",
          ...attrs,
        });
        g.appendChild(handle);
        const arrow = direction === "back" ? -1 : 1;
        g.appendChild(svgEl("path", {
          d: `M${px + offset - arrow * 2} ${py - 3} l${arrow * 3} 3 l${-arrow * 3} 3`,
          class: "ossschem-pin-arrow",
        }));
      }
    }
    // a splitter labels its branches, and lets the wire name the array
    const quiet = n.kind === "primitive" || (n.kind === "split" && p.name === "");
    if (!quiet) {
      const label = svgEl("text", {
        class: `ossschem-pin-label${isPortLike(n.kind) ? " ossschem-port-label" : ""}`,
        "data-id": p.id,
        "data-trace": pinTraceDirection(p.side, "outside"),
        "data-face": "outside",
        style: "pointer-events: auto; cursor: pointer; paint-order: stroke; stroke: var(--node-fill, var(--bg-raised)); stroke-width: 4px; stroke-linejoin: round",
        // an open end has no arrow to clear, so its name sits dead centre
        x: isPortLike(n.kind) ? String(n.w / 2 - (n.kind === "open" || n.badge === "inout" ? 0 : 5))
          : n.kind === "split" ? String(p.side === "W" ? -22 : n.w + 22)
          : p.side === "W" ? "20" : String(n.w - 20),
        y: String(n.children ? py - 7 : py + 4),
        "text-anchor": isPortLike(n.kind) ? "middle"
          : (p.side === "W") === (n.kind === "split") ? "end" : "start",
      });
      label.textContent = n.kind === "split" ? p.name : pinLabel(p);
      g.appendChild(label);
    }
  };

  const drawBody = (n: Level0Node, ox: number, oy: number): void => {
    const x = ox + n.x;
    const y = oy + n.y;
    const expanded = n.children !== undefined && n.children.length > 0;
    const isGate = n.kind === "primitive" && n.symbol !== undefined && !expanded;
    if (!isGate) {
      const g = svgEl("g", { class: `ossschem-kind-${n.kind}`, transform: `translate(${x} ${y})` });
      g.appendChild(
        svgEl(n.kind === "port" || n.kind === "split" ? "path" : "rect", {
          class: `ossschem-node-body${expanded ? " ossschem-compound" : ""}${selected === n.key ? " ossschem-selected" : ""}${cone.has(n.key) ? " ossschem-cone" : ""}${frontier.has(n.key) ? " ossschem-trace-frontier" : ""}`,
          width: String(n.w),
          height: String(n.h),
          rx: "5",
          ...(n.kind === "port" ? { d: portOutline(n.w, n.h, n.badge === "inout", n.pins[0]?.y) } : {}),
          ...(n.kind === "split" ? { d: splitOutline(n.w, n.h, n.badge === "fanout") } : {}),
          "data-id": n.key,
          "data-expand": n.kind === "primitive" || n.kind === "split" ? "" : n.key,
        }),
      );
      world.appendChild(g);
    }
    if (n.children !== undefined) {
      for (const ch of n.children) {
        drawBody(ch, x, y);
      }
    }
  };

  const drawChrome = (n: Level0Node, ox: number, oy: number): void => {
    const x = ox + n.x;
    const y = oy + n.y;
    const netSel = (wires.find(w => w.key === selected)?.netId ?? selectedNet(nodes, selected));
    const expanded = n.children !== undefined && n.children.length > 0;
    const isGate = n.kind === "primitive" && n.symbol !== undefined && !expanded;
    const g = svgEl("g", {
      class: `ossschem-node ossschem-kind-${n.kind} ossschem-node-${n.kind}${selected === n.key ? " ossschem-selected" : ""}${cone.has(n.key) ? " ossschem-cone" : ""}${frontier.has(n.key) ? " ossschem-trace-frontier" : ""}`,
      "data-id": n.key,
      transform: `translate(${x} ${y})`,
    });
    if (expanded) {
      g.appendChild(
        svgEl("rect", {
          class: "ossschem-header",
          width: String(n.w),
          height: "32",
          rx: "5",
          "data-id": n.key,
          "data-expand": n.key,
        }),
      );
    }
    if (isGate && n.symbol !== undefined) {
      g.appendChild(svgEl("rect", { class: "ossschem-primitive-selection", width: String(n.w), height: String(n.h), rx: "5", "data-id": n.key }));
      g.appendChild(drawSymbol(n.symbol, n.w, n.symbolHeight ?? n.h));
    }
    if (!isGate && !isPortLike(n.kind) && n.kind !== "split") {
      const title = svgEl("text", { class: "ossschem-node-title", x: "10", y: "20" });
      title.textContent = n.title;
      g.appendChild(title);
      if (n.badge !== undefined && n.badge.length > 0) {
        const canToggle = n.kind === "always" || n.kind === "assign" || n.kind === "instance" || n.kind === "instanceArray";
        const badge = svgEl("text", { class: "ossschem-node-badge", x: String(n.w - 10), y: "20", "text-anchor": "end" });
        badge.textContent = canToggle ? `${expanded ? "▾" : "▸"} ${n.badge}` : n.badge;
        g.appendChild(badge);
      }
    } else if (isGate && n.title.length > 0) {
      const lab = svgEl("text", {
        class: "ossschem-pin-label",
        x: String(n.w / 2),
        y: String(n.symbol?.includes("dff") || n.symbol === "memrd" || n.symbol === "memwr"
          ? mapSymbolPoint(40, n.symbol.includes("dff") ? 60 : 56, n.w, n.symbolHeight ?? n.h).y + 16
          : n.h - 8),
        "text-anchor": "middle",
      });
      lab.textContent = n.title;
      g.appendChild(lab);
    }
    for (const p of n.pins) {
      drawPin(g, n, p, netSel);
    }
    const note = annotate[n.key];
    if (note !== undefined) {
      const t = svgEl("text", { class: "ossschem-node-anno", x: String(n.w + 6), y: "20" });
      t.textContent = note;
      g.appendChild(t);
    }
    world.appendChild(g);
    if (n.children !== undefined) {
      for (const ch of n.children) {
        drawChrome(ch, x, y);
      }
    }
  };

  const draw = (): void => {
    world.classList.toggle("has-cone", cone.size > 0);
    world.replaceChildren();
    const netSel = (wires.find(w => w.key === selected)?.netId ?? selectedNet(nodes, selected));
    for (const n of nodes) {
      drawBody(n, 0, 0);
    }
    const occupied: LabelRect[] = [];
    walkNodes(nodes, (n, ox, oy) => {
      const x = ox + n.x;
      const y = oy + n.y;
      occupied.push({ x, y, w: n.w, h: n.children?.length ? 34 : n.h });
      if (n.kind !== "primitive" && n.children?.length) for (const p of n.pins) {
        const width = pinLabel(p).length * 7;
        occupied.push({ x: x + (p.side === "W" ? 16 : n.w - 24 - width),
          y: y + (p.y ?? 24) - 23, w: width + 8, h: 22 });
      }
    });
    const wireObstacles = wireClearances(wires);
    const busMarkers: SVGGElement[] = [];
    const valueLabels: SVGTextElement[] = [];
    const valued = new Map<string, { x: number; y: number }[]>();
    const marked = new Map<string, { x: number; y: number }[]>();
    for (const w of wires) {
      if (w.points.length < 2) {
        continue;
      }
      const d = w.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
      const on = cone.has(w.key) || (netSel !== null && w.netId === netSel);
      world.appendChild(svgEl("path", {
        class: "ossschem-wire-hit", d, fill: "none", stroke: "transparent",
        "stroke-width": "10", "pointer-events": "stroke", "data-id": w.key,
      }));
      world.appendChild(
        svgEl("path", {
          class: `ossschem-wire${(w.width ?? 1) > 1 ? " ossschem-wire-bus" : ""}${on ? " ossschem-wire-on" : ""}`,
          d,
          fill: "none",
          "data-id": w.key,
          "data-net": w.netId ?? w.netName ?? "",
          "data-width": String(w.width ?? ""),
        }),
      );
      /* One value per signal, placed the way a bus marker is: on a clear
       * stretch of the wire, and not repeated where a fan-out shares a trunk.
       * A branch off a splitter carries one array element, and its own value. */
      const netId = w.netId;
      const valueKey = netId === undefined ? undefined : signalValueKey(netId, w.element);
      const value = valueKey === undefined ? undefined : values[valueKey];
      if (value !== undefined && netId !== undefined && valueKey !== undefined) {
        const at = busLabelPosition(w.points, value, occupied, wireObstacles);
        const near = valued.get(valueKey) ?? [];
        if (at !== undefined && !crowdedByMarker(at, near)) {
          near.push(at);
          valued.set(valueKey, near);
          occupied.push(busMarkerBounds(at, value));
          const where = busLabelTextPosition(at);
          const text = svgEl("text", {
            class: `ossschem-value${netSel !== null && netId === netSel ? " ossschem-value-on" : ""}`,
            x: String(where.x), y: String(where.y),
            "text-anchor": where.anchor, "data-net": netId,
          });
          text.textContent = value;
          valueLabels.push(text);
        }
      }
      const shown = w.widthText ?? w.width;
      const marker = shown === undefined ? undefined : busLabelPosition(w.points, shown, occupied, wireObstacles);
      if (marker) {
        const tag = `${w.netId}:${shown}`;
        const already = marked.get(tag) ?? [];
        if (crowdedByMarker(marker, already)) continue;
        already.push({ x: marker.x, y: marker.y });
        marked.set(tag, already);
        occupied.push(busMarkerBounds(marker, shown!));
        const g = svgEl("g", { class: "ossschem-bus-marker", "data-id": w.key });
        const title = svgEl("title");
        title.textContent = `${w.netName ?? "Signal"} · ${w.widthText ?? `${w.width} bits`}`;
        g.appendChild(title);
        g.appendChild(svgEl("path", {
          d: `M${marker.x - 4} ${marker.y + 5} L${marker.x + 4} ${marker.y - 5}`,
          class: "ossschem-bus-slash",
        }));
        const textPosition = busLabelTextPosition(marker);
        const label = svgEl("text", {
          x: String(textPosition.x), y: String(textPosition.y), "text-anchor": textPosition.anchor,
          class: "ossschem-bus-label",
        });
        label.textContent = String(shown);
        g.appendChild(label);
        busMarkers.push(g);
      }
    }
    /* A fork gets a dot; wires that merely cross on their way past each other
     * do not. Drawn as a zero length stroke with a round cap, so the dot keeps
     * its size in screen pixels the way the wires keep their thickness. */
    for (const j of junctions) {
      const on = netSel !== null && j.netId === netSel;
      world.appendChild(svgEl("path", {
        class: `ossschem-junction${on ? " ossschem-junction-on" : ""}`,
        d: `M${j.x} ${j.y} L${j.x} ${j.y}`,
        "data-net": j.netId ?? "",
      }));
    }
    world.append(...busMarkers);
    for (const n of nodes) {
      drawChrome(n, 0, 0);
    }
    // last, so a value is never painted over by the box it sits in
    world.append(...valueLabels);
    applyCam();
  };

  const paintSelection = (): void => {
    const netSel = (wires.find(w => w.key === selected)?.netId ?? selectedNet(nodes, selected));
    world.querySelectorAll(".ossschem-selected").forEach((el) => el.classList.remove("ossschem-selected"));
    world.querySelectorAll(".ossschem-pin-on").forEach((el) => el.classList.remove("ossschem-pin-on"));
    world.querySelectorAll(".ossschem-wire").forEach((el) => el.classList.toggle("ossschem-wire-on", cone.has(el.getAttribute("data-id") ?? "")));
    world.querySelectorAll(".ossschem-junction").forEach((el) => el.classList.remove("ossschem-junction-on"));
    // a value belongs to a signal, so it lights with it
    world.querySelectorAll(".ossschem-value").forEach((el) =>
      el.classList.toggle("ossschem-value-on", netSel !== null && el.getAttribute("data-net") === netSel));
    if (selected !== null) {
      world.querySelectorAll(`[data-id="${CSS.escape(selected)}"]`).forEach((el) => {
        el.classList.add("ossschem-selected");
      });
    }
    if (netSel !== null) {
      world.querySelectorAll(".ossschem-pin").forEach((el) => {
        const id = el.getAttribute("data-id");
        if (id === null) {
          return;
        }
        let match = false;
        walkNodes(nodes, (n) => {
          if (n.pins.some((p) => p.id === id && p.netId === netSel)) {
            match = true;
          }
        });
        if (match) {
          el.classList.add("ossschem-pin-on");
        }
      });
      world.querySelectorAll(".ossschem-wire").forEach((el) => {
        if (el.getAttribute("data-net") === netSel) {
          el.classList.add("ossschem-wire-on");
        }
      });
      // a highlighted signal lights its forks too, or the dots would stay
      // muted on an otherwise highlighted net
      world.querySelectorAll(".ossschem-junction").forEach((el) => {
        if (el.getAttribute("data-net") === netSel) {
          el.classList.add("ossschem-junction-on");
        }
      });
    }
  };

  const controller: CanvasController = {
    onSelect: null,
    onDblClick: null,
    onTracePin: null,
    setNodes(next) {
      nodes = next;
      wires = [];
      junctions = [];
      values = {};
      collapsed = [];
      draw();
      listeners.forEach(listener => listener("scene"));
    },
    setScene(scene) {
      nodes = scene.nodes;
      wires = scene.wires;
      junctions = scene.junctions ?? [];
      collapsed = scene.collapsed;
      draw();
      listeners.forEach(listener => listener("scene"));
    },
    setSelection(key) {
      selected = key;
      paintSelection();
    },
    setAnnotate(next) {
      annotate = next;
      draw();
    },
    setValues(next) {
      values = next;
      draw();
    },
    setCone(keys, frontierKeys = []) {
      cone = new Set(keys);
      frontier = new Set(frontierKeys);
      draw();
    },
    zoomToFit(keys) {
      if (nodes.length === 0) {
        return;
      }
      const box = svg.getBoundingClientRect();
      if (box.width < 16 || box.height < 16) {
        return;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      walkNodes(nodes, (n, ox, oy) => {
        if (keys && !keys.includes(n.key)) return;
        minX = Math.min(minX, ox + n.x);
        minY = Math.min(minY, oy + n.y);
        maxX = Math.max(maxX, ox + n.x + n.w);
        maxY = Math.max(maxY, oy + n.y + n.h);
      });
      if (!Number.isFinite(minX)) return;
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const k = Math.min(box.width / (w + 64), box.height / (h + 64), 1.6);
      camera = {
        k,
        x: (box.width - k * (minX + maxX)) / 2,
        y: (box.height - k * (minY + maxY)) / 2,
      };
      applyCam();
    },
    focusElements(keys) {
      const bounds = elementBounds(nodes, wires, keys);
      const viewport = svg.getBoundingClientRect();
      if (!bounds || viewport.width < 16 || viewport.height < 16) return;
      camera = focusCamera(bounds, viewport, camera.k);
      applyCam();
    },
    camera: () => camera,
    scene: () => ({ nodes, wires, collapsed, junctions }),
    panTo(x, y) {
      camera = { ...camera, x, y };
      applyCam();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };

  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    if (drag || zoomDrag) return;
    const factor = ev.deltaY < 0 ? 1.05 : 1 / 1.05;
    const k = Math.min(8, Math.max(0.05, camera.k * factor));
    const rect = svg.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const wx = (px - camera.x) / camera.k;
    const wy = (py - camera.y) / camera.k;
    camera = { k, x: px - wx * k, y: py - wy * k };
    applyCam();
  }, { passive: false });

  const selectHit = (hit: Element | null): void => {
    const key = hit?.getAttribute("data-id") ?? null;
    const expandKey = hit?.getAttribute("data-expand") || (key === null ? null : key.split("::")[0]);
    const face = hit?.getAttribute("data-face") as PinFace | null;
    const direction = hit?.getAttribute("data-trace") as TraceDirection | null;
    const clickKey = `${key}|${face ?? "body"}`;
    const now = performance.now();
    const dbl =
      expandKey !== null &&
      expandKey.length > 0 &&
      lastClick !== null &&
      now - lastClick.t < 600 &&
      lastClick.nodeKey === clickKey;
    lastClick = expandKey ? { t: now, nodeKey: clickKey } : null;
    selected = key;
    paintSelection();
    controller.onSelect?.(key);
    if (dbl && expandKey !== null && expandKey.length > 0) {
      lastClick = null;
      if (direction && key) controller.onTracePin?.(key, direction, face ?? undefined);
      else controller.onDblClick?.(expandKey);
    }
  };

  svg.addEventListener("pointerdown", (ev) => {
    if (drag || zoomDrag) return;
    const pan = ev.button === 1 || (ev.button === 0 && (spaceDown || ev.altKey));
    if (pan) {
      drag = { pointerId: ev.pointerId, px: ev.clientX, py: ev.clientY, cx: camera.x, cy: camera.y };
      lastClick = null;
      svg.classList.add("ossschem-panning");
      svg.setPointerCapture(ev.pointerId);
      ev.preventDefault();
      return;
    }
    if (ev.button !== 0) return;
    const hit = (ev.target as Element | null)?.closest("[data-id]") ?? null;
    if (!hit || hit.classList.contains("ossschem-compound")) {
      const point = screenPoint(ev);
      zoomDrag = { pointerId: ev.pointerId, start: point, end: point, hit, moved: false };
      svg.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    } else selectHit(hit);
  });

  svg.addEventListener("pointermove", (ev) => {
    if (zoomDrag?.pointerId === ev.pointerId) {
      zoomDrag.end = screenPoint(ev);
      const { start, end } = zoomDrag;
      zoomDrag.moved ||= Math.hypot(end.x - start.x, end.y - start.y) >= 6;
      if (zoomDrag.moved) {
        svg.classList.add("ossschem-zooming");
        zoomRect.setAttribute("display", "inline");
        zoomRect.setAttribute("x", String(Math.min(start.x, end.x)));
        zoomRect.setAttribute("y", String(Math.min(start.y, end.y)));
        zoomRect.setAttribute("width", String(Math.abs(end.x - start.x)));
        zoomRect.setAttribute("height", String(Math.abs(end.y - start.y)));
      }
    }
    if (drag?.pointerId !== ev.pointerId) return;
    camera = { ...camera, x: drag.cx + (ev.clientX - drag.px), y: drag.cy + (ev.clientY - drag.py) };
    applyCam();
  });

  svg.addEventListener("pointerup", (ev) => {
    if (zoomDrag?.pointerId === ev.pointerId) {
      const { start, hit, moved } = zoomDrag;
      const end = screenPoint(ev);
      cancelGesture();
      if (moved || Math.hypot(end.x - start.x, end.y - start.y) >= 6) {
        lastClick = null;
        const next = rectangleZoomCamera(start, end, camera, svg.getBoundingClientRect());
        if (next) { camera = next; applyCam(); }
      } else selectHit(hit);
    } else if (drag?.pointerId === ev.pointerId) cancelGesture();
  });
  svg.addEventListener("pointercancel", cancelGesture);
  svg.addEventListener("lostpointercapture", cancelGesture);

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && (drag || zoomDrag)) { cancelGesture(); lastClick = null; }
    if (ev.target instanceof HTMLElement && ev.target.closest("input, textarea, select, [contenteditable=true]")) return;
    if (ev.code === "Space") {
      spaceDown = true;
    }
  });
  window.addEventListener("keyup", (ev) => {
    if (ev.code === "Space") {
      spaceDown = false;
    }
  });
  window.addEventListener("blur", () => { spaceDown = false; cancelGesture(); });

  applyCam();
  controllers.set(svg, controller);
  tagged.__ossschemCtl = controller;
  void collapsed;
  return controller;
}
