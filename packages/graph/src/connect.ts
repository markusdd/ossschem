import { viewIdKey, type Design, type Module } from "@ossschem/ir";
import {
  buildLevel0,
  clockResetNetIds,
  pinId,
  type Level0Edge,
  type Level0Node,
  type Pin,
} from "./level0.js";
import { connectionWidth } from "./width.js";
import { DEFAULT_FANOUT_LIMIT, defaultSession, type ViewSession } from "./session.js";

export interface CollapsedNetView {
  netName: string;
  fanout: number;
  portKey: string | null;
  stubKeys: string[];
}

export type { Level0Edge };

function allPins(nodes: Level0Node[]): { node: Level0Node; pin: Pin }[] {
  const out: { node: Level0Node; pin: Pin }[] = [];
  for (const n of nodes) {
    for (const p of n.pins) {
      out.push({ node: n, pin: p });
    }
  }
  return out;
}

type PinHit = { node: Level0Node; pin: Pin };

const SPLIT_W = 22;
const SPLIT_PITCH = 26;
const SPLIT_MARGIN = 16;

/* An unpacked array is several signals under one name, and a fan-out to its
 * elements is several connections over one route -- indistinguishable on the
 * sheet, and unaddressable with the pointer. A splitter gives them somewhere
 * to separate: the array arrives on one side, one branch per element leaves
 * the other, each branch a wire of its own.
 *
 * Nothing to split when the elements do not all face the same way: the array
 * is then read and written here, and there is no single trunk to draw.
 */
function planSplit(
  module: Module, path: string[], netId: string, hits: PinHit[],
): { node: Level0Node; edges: Level0Edge[] } | undefined {
  const irId = netId.slice(netId.lastIndexOf("#net:") + 5);
  const net = module.nets.find((n) => n.id === irId);
  if (net === undefined || net.kind !== "memory") {
    return undefined;
  }
  const branches = hits.filter((h) => h.pin.element !== undefined);
  const trunks = hits.filter((h) => h.pin.element === undefined);
  const elements = [...new Set(branches.map((h) => h.pin.element!))].sort((a, b) => a - b);
  const branchSide = new Set(branches.map((h) => h.pin.side));
  if (elements.length < 2 || trunks.length === 0 || branchSide.size !== 1) {
    return undefined;
  }
  // branches are loads: they sit to the right, so they leave the splitter east
  const fanOut = branches[0].pin.side === "W";
  if (trunks.some((h) => h.pin.side === branches[0].pin.side)) {
    return undefined;
  }
  const id = { path, irId: `${irId}:split` };
  const key = viewIdKey(id);
  const h = SPLIT_MARGIN * 2 + SPLIT_PITCH * Math.max(elements.length - 1, 1);
  const elementWidth = branches[0].pin.width ?? 1;
  const trunkPin: Pin = {
    // unnamed: the wire into a splitter already carries the array's name
    id: pinId(key, net.name), name: "", side: fanOut ? "W" : "E",
    netId, netName: net.name, width: elementWidth * elements.length,
    x: fanOut ? 0 : SPLIT_W, y: h / 2,
  };
  const branchPin = (element: number, index: number): Pin => ({
    id: pinId(key, `[${element}]`), name: `[${element}]`, side: fanOut ? "E" : "W",
    netId, netName: `${net.name}[${element}]`, width: elementWidth, element,
    x: fanOut ? SPLIT_W : 0, y: SPLIT_MARGIN + index * SPLIT_PITCH,
  });
  const pins = [trunkPin, ...elements.map(branchPin)];
  const byElement = new Map(elements.map((element, index) => [element, pins[index + 1]]));
  const edge = (from: PinHit | Pin, to: PinHit | Pin, extra: Partial<Level0Edge>): Level0Edge => {
    const source = "pin" in from ? from.pin : from;
    const target = "pin" in to ? to.pin : to;
    return {
      key: `${netId}:${source.id}->${target.id}`,
      netId, netName: net.name, width: source.width ?? target.width,
      sourceKey: "pin" in from ? from.node.key : key,
      targetKey: "pin" in to ? to.node.key : key,
      sourcePin: source.id, targetPin: target.id, ...extra,
    };
  };
  const trunkText = `${elements.length}\u00d7${elementWidth}b`;
  const edges = [
    ...trunks.map((t) => (fanOut ? edge(t, trunkPin, { widthText: trunkText, width: trunkPin.width })
      : edge(trunkPin, t, { widthText: trunkText, width: trunkPin.width }))),
    ...branches.map((b) => {
      const branch = byElement.get(b.pin.element!)!;
      const extra = { element: b.pin.element, netName: branch.netName, width: elementWidth };
      return fanOut ? edge(branch, b, extra) : edge(b, branch, extra);
    }),
  ];
  return {
    node: { key, id, kind: "split", title: net.name, badge: fanOut ? "fanout" : "fanin",
      x: 0, y: 0, w: SPLIT_W, h, pins },
    edges,
  };
}

export function buildLevel0Connectivity(
  design: Design,
  mod?: Module,
  session?: ViewSession,
  includeCollapsed = false,
): {
  nodes: Level0Node[];
  edges: Level0Edge[];
  collapsed: CollapsedNetView[];
} {
  const sess = session ?? defaultSession(design);
  const module = mod ?? design.modules[sess.moduleId] ?? design.modules[design.top];
  return buildModuleConnectivity(design, module, sess, includeCollapsed, true);
}

function buildModuleConnectivity(
  design: Design, module: Module, sess: ViewSession, includeCollapsed: boolean, hideClocks: boolean,
): ReturnType<typeof buildLevel0Connectivity> {
  const nodes = buildLevel0(design, module, sess);
  // Scope module-local net IDs by occurrence, including process interiors.
  const scope = (id: string): string => `${sess.path.join("/")}#net:${id}`;
  const scopeNodes = (list: Level0Node[]): void => {
    for (const n of list) {
      n.pins.forEach((p) => { p.netId = scope(p.netId); });
      n.interiorEdges?.forEach((e) => { e.netId = scope(e.netId); });
      scopeNodes(n.children ?? []);
    }
  };
  scopeNodes(nodes);
  for (const node of nodes) {
    if (node.kind !== "instance" || !sess.expansion.has(node.key)) continue;
    const inst = module.instances.find((i) => i.id === node.id.irId);
    if (inst?.kind !== "instance" || !design.modules[inst.module]) continue;
    const child = buildModuleConnectivity(design, design.modules[inst.module], {
      ...sess, moduleId: inst.module, path: [...sess.path, ...inst.relPath],
    }, includeCollapsed, false);
    const boundaries = new Map<string, { pin: Pin; key: string }>();
    const aliases = new Map<string, string>();
    for (const port of child.nodes.filter((n) => n.kind === "port")) {
      const pin = node.pins.find((p) => p.name === port.title);
      if (!pin) continue;
      boundaries.set(port.pins[0].id, { pin, key: node.key });
      aliases.set(port.pins[0].netId, pin.netId);
    }
    node.children = child.nodes.filter((n) => n.kind !== "port");
    node.interiorEdges = child.edges.map((e) => ({ ...e,
      sourceKey: boundaries.get(e.sourcePin)?.key ?? e.sourceKey,
      sourcePin: boundaries.get(e.sourcePin)?.pin.id ?? e.sourcePin,
      targetKey: boundaries.get(e.targetPin)?.key ?? e.targetKey,
      targetPin: boundaries.get(e.targetPin)?.pin.id ?? e.targetPin,
    }));
    const alias = (n: Level0Node): void => {
      n.pins.forEach((p) => { p.netId = aliases.get(p.netId) ?? p.netId; });
      n.interiorEdges?.forEach((e) => { e.netId = aliases.get(e.netId) ?? e.netId; });
      n.children?.forEach(alias);
    };
    alias(node);
  }
  const clocks = new Set([...clockResetNetIds(module)].map(scope));
  const edges: Level0Edge[] = [];
  const collapsed: CollapsedNetView[] = [];
  const pins = allPins(nodes);

  const byNet = new Map<string, { node: Level0Node; pin: Pin }[]>();
  for (const hit of pins) {
    const list = byNet.get(hit.pin.netId) ?? [];
    list.push(hit);
    byNet.set(hit.pin.netId, list);
  }

  for (const [netId, hits] of byNet) {
    const name = hits[0]?.pin.netName ?? netId;
    const uniqueNodes = [...new Set(hits.map((h) => h.node.key))];
    const drivers = hits.filter((h) => h.pin.side === "E");
    const loads = hits.filter((h) => h.pin.side === "W");
    const fanout = new Set(loads.map(h => h.node.key)).size;
    const limit = sess.fanoutLimit ?? DEFAULT_FANOUT_LIMIT;
    // Expanded instances use their local fanout, independent of the outer clock/reset policy.
    const stubbed = (hideClocks && clocks.has(netId)) || (limit > 0 && fanout >= limit);
    hits.forEach(h => { h.pin.collapsed = stubbed; });
    if (stubbed) {
      const portNode = hits.find((h) => h.node.kind === "port");
      collapsed.push({
        netName: name,
        fanout,
        portKey: portNode?.node.key ?? null,
        stubKeys: uniqueNodes,
      });
      if (!includeCollapsed) continue;
    }
    const split = stubbed ? undefined : planSplit(module, sess.path, netId, hits);
    if (split !== undefined) {
      nodes.push(split.node);
      edges.push(...split.edges);
      continue;
    }
    for (const d of drivers) {
      for (const l of loads) {
        if (d.node.key === l.node.key) {
          continue;
        }
        edges.push({
          key: `${netId}:${d.pin.id}->${l.pin.id}`,
          stubbed,
          width: connectionWidth(d.pin.width, l.pin.width),
          netName: name,
          netId,
          sourceKey: d.node.key,
          targetKey: l.node.key,
          sourcePin: d.pin.id,
          targetPin: l.pin.id,
        });
      }
    }
  }

  return { nodes, edges, collapsed };
}

export function nodeByKey(nodes: Level0Node[], key: string): Level0Node | undefined {
  return nodes.find((n) => n.key === key);
}
