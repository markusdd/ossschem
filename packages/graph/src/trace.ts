import type { Design } from "@ossschem/ir";
import { buildLevel0Connectivity } from "./connect.js";
import { defaultSession, type ViewSession } from "./session.js";
import { copySession, expandComponent, flattenNodes, sceneEdges } from "./visible.js";

export type TraceDirection = "back" | "forward";
export type PinFace = "inside" | "outside";

export function pinTraceDirection(side: "W" | "E", face: PinFace): TraceDirection {
  return (side === "W") === (face === "outside") ? "back" : "forward";
}

/** Follow wires through open boundaries, stopping at the next leaf component. */
export function hopAtBoundary(
  design: Design,
  selectedKey: string,
  direction: TraceDirection,
  sessionOrModule?: ViewSession | string,
): string[] {
  const session = typeof sessionOrModule === "object" ? sessionOrModule : defaultSession(design);
  if (typeof sessionOrModule === "string") {
    session.moduleId = sessionOrModule;
    session.path = [design.modules[sessionOrModule]?.name ?? sessionOrModule];
  }
  const graph = buildLevel0Connectivity(design, undefined, session, true);
  const nodes = flattenNodes(graph.nodes);
  const edges = sceneEdges(graph);
  const owners = new Map(nodes.flatMap(n => n.pins.map(p => [p.id, n] as const)));
  const keys = new Set<string>([selectedKey]);
  const queue: string[] = [];
  const wire = edges.find(e => e.key === selectedKey);
  if (wire) queue.push(direction === "back" ? wire.sourcePin : wire.targetPin);
  if (owners.has(selectedKey)) queue.push(selectedKey);
  const node = nodes.find(n => n.key === selectedKey);
  if (node) queue.push(...node.pins.filter(p => node.kind === "port" || p.side === (direction === "back" ? "W" : "E")).map(p => p.id));
  const starts = new Set(queue);
  const visited = new Set<string>();
  while (queue.length) {
    const pin = queue.shift()!;
    if (visited.has(pin)) continue;
    visited.add(pin);
    keys.add(pin);
    const owner = owners.get(pin);
    if (!owner) continue;
    keys.add(owner.key);
    if (!starts.has(pin) && owner.children === undefined) continue;
    for (const e of edges) {
      if ((direction === "back" ? e.targetPin : e.sourcePin) !== pin) continue;
      keys.add(e.key);
      queue.push(direction === "back" ? e.sourcePin : e.targetPin);
    }
  }
  return [...keys];
}

/** Reveal one directional hop without discarding the existing exploration. */
export function revealTrace(design: Design, session: ViewSession, key: string, direction: TraceDirection, face?: PinFace): ViewSession {
  const next = copySession(session);
  if (face === "inside") {
    const nodeKey = key.split("::")[0];
    const original = flattenNodes(buildLevel0Connectivity(design, undefined, session).nodes).find(n => n.key === nodeKey);
    if (original?.kind === "instanceArray") return expandComponent(design, session, key, true);
    if (original && ["always", "assign", "instance"].includes(original.kind)) {
      if (!next.expansion.has(nodeKey)) next.partial!.set(nodeKey, new Set());
      next.expansion.add(nodeKey);
    }
  }
  const graph = buildLevel0Connectivity(design, undefined, next, true);
  const keys = new Set(hopAtBoundary(design, key, direction, next));
  for (const node of flattenNodes(graph.nodes)) {
    if (keys.has(node.key)) next.visible?.add(node.key);
    const partial = next.partial?.get(node.key);
    if (partial) for (const child of node.children ?? []) {
      if (flattenNodes([child]).some(n => keys.has(n.key))) partial.add(child.key);
    }
  }
  for (const e of sceneEdges(graph)) if (keys.has(e.key)) {
    next.revealedEdges!.add(e.key);
    next.hiddenEdges?.delete(e.key);
  }
  return next;
}
