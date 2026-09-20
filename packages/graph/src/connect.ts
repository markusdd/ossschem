import type { Design, Module } from "@ossschem/ir";
import {
  buildLevel0,
  clockResetNetIds,
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
