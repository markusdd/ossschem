import type { Design } from "@ossschem/ir";
import { buildLevel0Connectivity } from "./connect.js";
import type { Level0Node, Pin } from "./level0.js";
import { moduleAtKey, type ViewSession } from "./session.js";
import type { TraceDirection } from "./trace.js";
import { copySession, flattenNodes, sceneEdges } from "./visible.js";

export interface TraceProgress {
  origin: string;
  direction: TraceDirection;
  step: number;
  frontier: string[];
  visited: Set<string>;
  keys: Set<string>;
  focus: string[];
}

/** Data dependencies of a primitive. Explicitly selected clock/reset pins can still be traced. */
function exits(node: Level0Node, direction: TraceDirection): Pin[] {
  return node.pins.filter(p => p.side === (direction === "forward" ? "E" : "W") &&
    (direction !== "back" || !node.symbol?.includes("dff") || p.name === "D" || p.name === "EN") &&
    (direction !== "back" || !["CLK", "ARST", "SRST"].includes(p.name)));
}

/** Advance every unfinished branch once; open boundaries are transparent, closed ones take a step. */
export function advanceTrace(design: Design, session: ViewSession, origin: string, direction: TraceDirection,
  options: { restart?: boolean } = {}): ViewSession {
  const previous = !options.restart && session.trace?.origin === origin && session.trace.direction === direction
    ? session.trace : undefined;
  if (previous && previous.frontier.length === 0) return session;
  const next = copySession(session);
  const visited = new Set(previous?.visited);
  const keys = new Set(previous?.keys ?? [origin]);
  const focus = new Set<string>();
  let graph = buildLevel0Connectivity(design, undefined, next, true);
  let nodes = flattenNodes(graph.nodes);
  let owners = new Map(nodes.flatMap(n => n.pins.map(p => [p.id, { node: n, pin: p }] as const)));
  const inward = (p: Pin): boolean => p.side === (direction === "forward" ? "W" : "E");
  let seeds: { key: string; cross: boolean }[];
  if (previous) seeds = previous.frontier.map(key => ({ key, cross: true }));
  else {
    const wire = sceneEdges(graph).find(e => e.key === origin);
    const node = nodes.find(n => n.key === origin);
    if (wire) {
      // A wire selection first reaches its endpoint, just as a pin-to-wire hop does.
      keys.add(wire.key); focus.add(wire.key); next.revealedEdges!.add(wire.key); next.hiddenEdges!.delete(wire.key);
      seeds = [{ key: direction === "forward" ? wire.targetPin : wire.sourcePin, cross: false }];
    } else if (owners.has(origin)) seeds = [{ key: origin, cross: true }];
    else seeds = (node ? node.kind === "port" ? node.pins : exits(node, direction) : []).map(p => ({ key: p.id, cross: true }));
  }

  const replacements = new Map<string, string[]>();
  let changed = false;
  for (const seed of seeds) {
    const owner = owners.get(seed.key);
    if (!owner || !seed.cross || !inward(owner.pin)) continue;
    const { node, pin } = owner;
    if (node.kind === "instanceArray") {
      const scope = moduleAtKey(design, next, node.key);
      const array = design.modules[scope.moduleId]?.instances.find(i => i.id === node.id.irId);
      if (array?.kind !== "instanceArray") continue;
      next.exploded.add(node.key);
      replacements.set(pin.id, array.members.map(id => `${scope.path.join("/")}#${id}::${pin.name}`));
      changed = true;
    } else if (["always", "assign", "instance"].includes(node.kind) && node.children === undefined) {
      next.expansion.add(node.key);
      next.partial!.set(node.key, new Set());
      changed = true;
    }
  }
  if (changed) {
    graph = buildLevel0Connectivity(design, undefined, next, true);
    nodes = flattenNodes(graph.nodes);
    owners = new Map(nodes.flatMap(n => n.pins.map(p => [p.id, { node: n, pin: p }] as const)));
  }
  const edges = sceneEdges(graph);
  const adjacency = new Map<string, typeof edges>();
  for (const edge of edges) {
    const pin = direction === "forward" ? edge.sourcePin : edge.targetPin;
    const list = adjacency.get(pin) ?? [];
    list.push(edge); adjacency.set(pin, list);
  }
  const revealEdge = (edge: typeof edges[number]): void => {
    keys.add(edge.key); focus.add(edge.key);
    keys.add(edge.sourceKey); keys.add(edge.targetKey);
    next.revealedEdges!.add(edge.key); next.hiddenEdges!.delete(edge.key);
  };
  seeds = seeds.flatMap(seed => {
    const members = replacements.get(seed.key);
    if (!members) return [seed];
    visited.add(seed.key);
    return members.filter(key => owners.has(key)).map(key => {
      // Array expansion replaces its boundary wires with member-instance wires.
      for (const e of edges) if ((direction === "forward" ? e.targetPin : e.sourcePin) === key) revealEdge(e);
      return { key, cross: false };
    });
  });
  const frontier = new Set<string>();
  const queue = [...seeds];
  for (let i = 0; i < queue.length; i++) {
    const { key, cross } = queue[i];
    const owner = owners.get(key);
    if (!owner) continue;
    const { node, pin } = owner;
    keys.add(key); keys.add(node.key); focus.add(key);
    if (visited.has(key)) continue;
    if (!cross && node.children === undefined) {
      if (node.kind !== "port" && node.symbol !== "const" && node.symbol !== "opaque") frontier.add(key);
      continue;
    }
    visited.add(key);
    if (node.kind === "primitive" && inward(pin)) {
      if (node.symbol !== "opaque") for (const p of exits(node, direction)) queue.push({ key: p.id, cross: true });
      continue;
    }
    for (const edge of adjacency.get(key) ?? []) {
      revealEdge(edge);
      queue.push({ key: direction === "forward" ? edge.targetPin : edge.sourcePin, cross: false });
    }
  }
  // Only add reached children to partial containers, including nested ancestors.
  const revealNodes = (list: Level0Node[]): boolean => {
    let any = false;
    for (const node of list) {
      const descendant = revealNodes(node.children ?? []);
      const reached = keys.has(node.key) || descendant;
      if (reached) { next.visible?.add(node.key); any = true; }
      if (descendant) {
        const partial = next.partial?.get(node.key);
        for (const child of node.children ?? []) if (keys.has(child.key) || next.visible?.has(child.key)) partial?.add(child.key);
      }
      if (descendant) keys.add(node.key);
    }
    return any;
  };
  revealNodes(graph.nodes);
  next.trace = { origin, direction, step: (previous?.step ?? 0) + 1, frontier: [...frontier].filter(k => !visited.has(k)),
    visited, keys, focus: [...focus] };
  return next;
}
