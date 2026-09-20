import { orthogonalPoints, pinLabel, placeGatePins, type Level0Edge, type Level0Node } from "@ossschem/graph";

export const ELK_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.separateConnectedComponents": "false",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
  "elk.layered.spacing.nodeNodeBetweenLayers": "72",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.spacing.nodeNode": "28",
  "elk.spacing.edgeNode": "24",
  "elk.spacing.edgeEdge": "28",
  "elk.spacing.portPort": "28",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "40",
  "elk.spacing.portsSurrounding": "[top=48,left=0,bottom=24,right=0]",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
};

export interface ElkPort {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
}

export interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  ports?: ElkPort[];
  edges?: ElkEdge[];
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  sections?: {
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: { x: number; y: number }[];
  }[];
}

function nodeToElk(n: Level0Node): ElkNode {
  const placed = packPins(n);
  const fixed = n.kind === "primitive";
  const elk: ElkNode = {
    id: n.key,
    ports: placed.pins.map((p, i) => ({
      id: p.id,
      x: p.side === "W" ? 0 : placed.w,
      y: p.y,
      width: 1,
      height: 1,
      layoutOptions: {
        "elk.port.side": p.side === "W" ? "WEST" : "EAST",
        "elk.port.index": String(i),
      },
    })),
    layoutOptions: {
      "elk.portConstraints": "FIXED_POS",
      ...(fixed ? { "elk.nodeSize.constraints": "FIXED" } : {}),
      ...(n.kind === "port" ? {
        "elk.layered.layering.layerConstraint": n.badge === "in" ? "FIRST_SEPARATE" : "LAST_SEPARATE",
      } : {}),
    },
  };
  if (n.children !== undefined && n.children.length > 0) {
    elk.layoutOptions = {
      "elk.portConstraints": "FIXED_SIDE",
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": `[top=56,left=${Math.max(64, ...n.pins.filter(p => p.side === "W").map(p => pinLabel(p).length * 7 + 32))},bottom=40,right=${Math.max(64, ...n.pins.filter(p => p.side === "E").map(p => pinLabel(p).length * 7 + 32))}]`,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "36",
      "elk.spacing.portPort": "28",
      "elk.spacing.edgeEdge": "28",
      "elk.spacing.edgeNode": "24",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "40",
      "elk.spacing.portsSurrounding": "[top=48,left=0,bottom=24,right=0]",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
    };
    elk.children = placed.children?.map(nodeToElk) ?? n.children.map(nodeToElk);
    elk.edges = (n.interiorEdges ?? []).map((e) => ({
      id: e.key,
      sources: [e.sourcePin],
      targets: [e.targetPin],
    }));
  } else {
    elk.width = n.w;
    elk.height = n.h;
  }
  return elk;
}

export function toElkGraph(nodes: Level0Node[], edges: Level0Edge[]): ElkNode {
  return {
    id: "root",
    layoutOptions: ELK_OPTIONS,
    children: nodes.map(nodeToElk),
    edges: edges.map((e) => ({
      id: e.key,
      sources: [e.sourcePin],
      targets: [e.targetPin],
    })),
  };
}

export interface LaidOut {
  nodes: Level0Node[];
  edges: { key: string; sourcePin: string; targetPin: string; width?: number; netId?: string; netName?: string; points: { x: number; y: number }[] }[];
}

const HEADER = 36;

function packPins(n: Level0Node): Level0Node {
  if (n.kind === "port") return { ...n, pins: n.pins.map(p => ({ ...p, x: p.side === "W" ? 0 : n.w, y: n.h / 2 })) };
  if (n.kind === "primitive") {
    return {
      ...n,
      pins: placeGatePins(n),
      children: n.children?.map(packPins),
    };
  }
  const header = n.children !== undefined && n.children.length > 0 ? HEADER : 28;
  const packSide = (side: "W" | "E"): typeof n.pins => {
    const ps = n.pins.filter((p) => p.side === side);
    if (ps.length === 0) {
      return [];
    }
    const first = header + 12;
    const last = n.h - 24;
    const usable = Math.max(0, last - first);
    return ps.map((p, i) => ({
      ...p,
      x: side === "W" ? 0 : n.w,
      y: first + (ps.length === 1 ? usable / 2 : i * (usable / Math.max(ps.length - 1, 1))),
    }));
  };
  return {
    ...n,
    pins: [...packSide("W"), ...packSide("E")],
    children: n.children?.map(packPins),
  };
}

function applyElk(n: Level0Node, elk: ElkNode, ox: number, oy: number): Level0Node {
  const x = ox + (elk.x ?? 0);
  const y = oy + (elk.y ?? 0);
  const w = n.kind === "primitive" ? n.w : (elk.width ?? n.w);
  const h = n.kind === "primitive" ? n.h : (elk.height ?? n.h);
  const children = n.children?.map((ch) => {
    const ce = (elk.children ?? []).find((c) => c.id === ch.key);
    return ce === undefined ? ch : applyElk(ch, ce, 0, 0);
  });
  if (n.kind === "primitive") {
    return {
      ...n,
      x,
      y,
      w,
      h,
      pins: placeGatePins({ ...n, w, h }),
      children,
      interiorEdges: n.interiorEdges,
    };
  }
  if (n.kind === "port") return { ...n, x, y, w, h,
    pins: n.pins.map(p => ({ ...p, x: p.side === "W" ? 0 : w, y: h / 2 })) };
  const elkPort = new Map((elk.ports ?? []).map((p) => [p.id, p]));
  const pins = n.pins.map((p) => {
    const ep = elkPort.get(p.id);
    if (ep?.x === undefined || ep.y === undefined) {
      return {
        ...p,
        x: p.side === "W" ? 0 : w,
        y: p.y ?? h / 2,
      };
    }
    return { ...p, x: ep.x, y: ep.y };
  });
  return { ...n, x, y, w, h, pins, children, interiorEdges: n.interiorEdges };
}

function pinAbs(
  nodes: Level0Node[],
  pinId: string,
  ox = 0,
  oy = 0,
): { x: number; y: number } | undefined {
  for (const n of nodes) {
    const px = ox + n.x;
    const py = oy + n.y;
    const pin = n.pins.find((p) => p.id === pinId);
    if (pin !== undefined) {
      return { x: px + (pin.x ?? (pin.side === "W" ? 0 : n.w)), y: py + (pin.y ?? n.h / 2) };
    }
    if (n.children !== undefined) {
      const hit = pinAbs(n.children, pinId, px, py);
      if (hit !== undefined) {
        return hit;
      }
    }
  }
  return undefined;
}

function collectElkRoutes(
  elk: ElkNode,
  ox: number,
  oy: number,
  into: Map<string, { x: number; y: number }[]>,
): void {
  for (const e of elk.edges ?? []) {
    const sec = e.sections?.[0];
    if (sec === undefined) {
      continue;
    }
    into.set(e.id, [
      { x: sec.startPoint.x + ox, y: sec.startPoint.y + oy },
      ...(sec.bendPoints ?? []).map((p) => ({ x: p.x + ox, y: p.y + oy })),
      { x: sec.endPoint.x + ox, y: sec.endPoint.y + oy },
    ]);
  }
  for (const c of elk.children ?? []) {
    collectElkRoutes(c, ox + (c.x ?? 0), oy + (c.y ?? 0), into);
  }
}

function slideEnd(
  pts: { x: number; y: number }[],
  pin: { x: number; y: number },
  atStart: boolean,
): { x: number; y: number }[] {
  if (pts.length === 0) {
    return [pin];
  }
  const out = pts.slice();
  const i = atStart ? 0 : out.length - 1;
  const j = atStart ? Math.min(1, out.length - 1) : Math.max(0, out.length - 2);
  const end = out[i];
  const nbr = out[j];
  const horiz = Math.abs(end.y - nbr.y) < 1;
  if (horiz) {
    out[i] = { x: pin.x, y: end.y };
    return out;
  }
  out[i] = { x: end.x, y: pin.y };
  return out;
}

/** ELK routes to node-border ports. We only slide the last segment onto the glyph pin (same axis). */
export function fromElkGraph(raw: ElkNode, nodes: Level0Node[], edges: Level0Edge[]): LaidOut {
  const laidNodes = nodes.map((n) => {
    const elk = (raw.children ?? []).find((c) => c.id === n.key);
    return elk === undefined ? packPins(n) : applyElk(n, elk, 0, 0);
  });
  // ELK can offset unconnected ports within the outer layers. Align connection points,
  // independent of label width or whether a wire is currently visible.
  const inputs = laidNodes.filter(n => n.kind === "port" && n.badge === "in");
  const inputTip = Math.max(...inputs.map(n => n.x + n.w));
  for (const node of inputs) node.x = inputTip - node.w;
  const outputs = laidNodes.filter(n => n.kind === "port" && (n.badge === "out" || n.badge === "inout"));
  const outputConnection = Math.min(...outputs.map(n => n.x));
  for (const node of outputs) node.x = outputConnection;
  const interiors = (list: Level0Node[]): Level0Edge[] => list.flatMap(n => [...(n.interiorEdges ?? []), ...interiors(n.children ?? [])]);
  const allOrig = [...edges, ...interiors(nodes)];
  const elkRoutes = new Map<string, { x: number; y: number }[]>();
  collectElkRoutes(raw, 0, 0, elkRoutes);
  const routed: LaidOut["edges"] = [];
  for (const e of allOrig) {
    const elkPts = elkRoutes.get(e.key);
    const a = pinAbs(laidNodes, e.sourcePin);
    const b = pinAbs(laidNodes, e.targetPin);
    if (elkPts !== undefined && elkPts.length >= 2) {
      let points = elkPts;
      if (a !== undefined) {
        points = slideEnd(points, a, true);
      }
      if (b !== undefined) {
        points = slideEnd(points, b, false);
      }
      routed.push({ key: e.key, width: e.width, sourcePin: e.sourcePin, targetPin: e.targetPin, netId: e.netId, netName: e.netName, points });
      continue;
    }
    if (a === undefined || b === undefined) {
      continue;
    }
    routed.push({ key: e.key, width: e.width, sourcePin: e.sourcePin, targetPin: e.targetPin, netId: e.netId, netName: e.netName, points: orthogonalPoints(a, b) });
  }
  return { nodes: laidNodes, edges: routed };
}
