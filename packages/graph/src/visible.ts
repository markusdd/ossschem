import type { Design } from "@ossschem/ir";
import { buildLevel0Connectivity } from "./connect.js";
import type { Level0Edge, Level0Node } from "./level0.js";
import type { ViewSession } from "./session.js";

export function flattenNodes(nodes: Level0Node[]): Level0Node[] {
  return nodes.flatMap(n => [n, ...flattenNodes(n.children ?? [])]);
}

export function sceneEdges(graph: { nodes: Level0Node[]; edges: Level0Edge[] }): Level0Edge[] {
  return [...graph.edges, ...flattenNodes(graph.nodes).flatMap(n => n.interiorEdges ?? [])];
}

export function copySession(s: ViewSession): ViewSession {
  return { ...s, expansion: new Set(s.expansion), exploded: new Set(s.exploded),
    partial: new Map([...s.partial ?? []].map(([key, children]) => [key, new Set(children)])),
    visible: s.visible && new Set(s.visible), revealedEdges: new Set(s.revealedEdges), hiddenEdges: new Set(s.hiddenEdges) };
}

/** Hide a single wire branch without discarding its endpoints or neighboring branches. */
export function collapseWire(session: ViewSession, key: string): ViewSession {
  const next = copySession(session);
  next.hiddenEdges!.add(key);
  next.revealedEdges!.delete(key);
  return next;
}

/** Filter only after constructing connectivity so hidden neighbors remain discoverable. */
export function buildVisibleConnectivity(design: Design, session: ViewSession) {
  const full = buildLevel0Connectivity(design, undefined, session, true);
  const all = flattenNodes(full.nodes);
  const edges = sceneEdges(full);
  const keepNodes = (nodes: Level0Node[], parent?: string): Level0Node[] => nodes.flatMap(n => {
    if (parent && session.partial?.has(parent) && !session.partial.get(parent)!.has(n.key)) return [];
    const children = n.children && keepNodes(n.children, n.key);
    if (session.visible && !session.visible.has(n.key) && !children?.length) return [];
    return [{ ...n, pins: n.pins.map(p => ({ ...p })), children }];
  });
  const nodes = keepNodes(full.nodes);
  const visible = new Set(flattenNodes(nodes).map(n => n.key));
  const keepEdge = (e: Level0Edge): boolean => visible.has(e.sourceKey) && visible.has(e.targetKey) &&
    !session.hiddenEdges?.has(e.key) && (!e.stubbed || !!session.revealedEdges?.has(e.key));
  const drawn = new Set(edges.filter(keepEdge).map(e => e.key));
  for (const n of flattenNodes(nodes)) {
    const original = all.find(x => x.key === n.key)!;
    const interior = new Set((original.interiorEdges ?? []).map(e => e.key));
    n.interiorEdges = original.interiorEdges?.filter(keepEdge);
    for (const p of n.pins) {
      const attached = edges.filter(e => e.sourcePin === p.id || e.targetPin === p.id);
      const expandable = ["always", "assign", "instance", "instanceArray"].includes(n.kind);
      p.handles = {
        inside: expandable && (original.children === undefined || attached.some(e => interior.has(e.key) && !drawn.has(e.key))),
        outside: attached.some(e => !interior.has(e.key) && !drawn.has(e.key)),
      };
    }
  }
  return { nodes, edges: full.edges.filter(keepEdge), collapsed: full.collapsed.filter(c => c.stubKeys.some(k => visible.has(k))) };
}

export function isolateComponent(design: Design, session: ViewSession, key: string): ViewSession {
  const next = copySession(session);
  const node = flattenNodes(buildLevel0Connectivity(design, undefined, session).nodes).find(n => n.key === key.split("::")[0]);
  if (node) next.visible = new Set(flattenNodes([node]).map(n => n.key));
  return next;
}

/** Explicit body expansion reveals the complete contents, even in an isolated view. */
export function expandComponent(design: Design, session: ViewSession, key: string, expandOnly = false): ViewSession {
  const next = copySession(session);
  const nodeKey = key.split("::")[0];
  const node = flattenNodes(buildLevel0Connectivity(design, undefined, session).nodes).find(n => n.key === nodeKey);
  if (!node || !["always", "assign", "instance", "instanceArray"].includes(node.kind)) return next;
  const set = node.kind === "instanceArray" ? next.exploded : next.expansion;
  const wasPartial = next.partial?.delete(nodeKey);
  if (set.has(nodeKey) && !expandOnly && !wasPartial) set.delete(nodeKey);
  else set.add(nodeKey);
  if (set.has(nodeKey) && next.hiddenEdges?.size) {
    const opened = flattenNodes(buildLevel0Connectivity(design, undefined, next, true).nodes).find(n => n.key === nodeKey);
    if (opened) sceneEdges({ nodes: [opened], edges: [] }).forEach(e => next.hiddenEdges!.delete(e.key));
  }
  if (next.visible) {
    const graph = buildLevel0Connectivity(design, undefined, next);
    const opened = flattenNodes(graph.nodes).find(n => n.key === nodeKey);
    if (opened) flattenNodes([opened]).forEach(n => next.visible!.add(n.key));
    else if (node.kind === "instanceArray") {
      // Exploding an array replaces it with member nodes in the same module occurrence.
      const before = new Set(flattenNodes(buildLevel0Connectivity(design, undefined, session).nodes).map(n => n.key));
      flattenNodes(graph.nodes).filter(n => !before.has(n.key)).forEach(n => next.visible!.add(n.key));
    }
  }
  return next;
}
