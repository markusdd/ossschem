import { prettyNet, type Design, type SourceSpan } from "@ossschem/ir";
import { isPortLike, parseViewKey, type Level0Node } from "./level0.js";
import { moduleAtKey, type ViewSession } from "./session.js";
import { buildLevel0Connectivity } from "./connect.js";
import { copySession, flattenNodes, sceneEdges } from "./visible.js";

export interface SignalEndpoint {
  pinKey: string;
  nodeKey: string;
  title: string;
  canExpand: boolean;
}

export interface SelectionInfo {
  title: string;
  span?: SourceSpan;
  expr?: string;
  fileBasename?: string;
  sourceKind?: "declaration" | "expression";
  signal?: { netId: string; drivers: SignalEndpoint[]; loads: SignalEndpoint[] };
}

function signalContext(design: Design, session: ViewSession, key: string) {
  const graph = buildLevel0Connectivity(design, undefined, session, true);
  const nodes = flattenNodes(graph.nodes);
  const allEdges = sceneEdges(graph);
  const wire = allEdges.find(e => e.key === key);
  // an open end is a signal entering or leaving the drawing, same as a port
  const port = nodes.find(n => n.key === key && isPortLike(n.kind));
  const pin = port?.pins[0] ?? nodes.flatMap(n => n.pins).find(p => p.id === key);
  const netId = wire?.netId ?? pin?.netId;
  if (!netId) return null;
  return { nodes, netId, edges: allEdges.filter(e => e.netId === netId),
    starts: wire ? [wire.sourcePin, wire.targetPin] : [pin!.id],
    name: wire?.netName ?? pin!.netName };
}

function signalInfo(design: Design, session: ViewSession, key: string): SelectionInfo | null {
  const context = signalContext(design, session, key);
  if (!context) return null;
  const { nodes, edges, netId } = context;
  const split = netId.lastIndexOf("#net:");
  const irId = netId.slice(split + 5);
  const owner = moduleAtKey(design, session, `${netId.slice(0, split)}#${irId}`);
  const mod = design.modules[owner.moduleId];
  const declared = mod?.nets.find(n => n.id === irId);
  const box = mod?.boxes.find(b => b.contents.nets.some(n => n.id === irId));
  const temporary = box?.contents.nets.find(n => n.id === irId);
  const producer = box?.contents.cells.find(c => c.pins.Y?.net === irId || c.pins.Q?.net === irId);
  const validSpan = (span: SourceSpan | undefined): span is SourceSpan => !!span && span.startLine > 0 && span.endLine >= span.startLine && !!span.file;
  const declaration = validSpan(declared?.span) ? declared : undefined;
  const span = [declaration?.span, temporary?.span, producer?.span, box?.span].find(validSpan);
  const sources = new Set(edges.map(e => e.sourcePin));
  const targets = new Set(edges.map(e => e.targetPin));
  const endpoints = (pins: Set<string>, opposite: Set<string>): SignalEndpoint[] => [...pins]
    // Open boundaries are pass-through connections, not additional drivers or loads.
    .filter(pin => !opposite.has(pin))
    .flatMap(pinKey => {
      const node = nodes.find(n => n.pins.some(p => p.id === pinKey));
      if (!node) return [];
      const pin = node.pins.find(p => p.id === pinKey)!;
      return [{ pinKey, nodeKey: node.key,
        title: `${node.id.path.join(" / ")} / ${node.title || node.symbol || node.kind}${node.kind === "port" ? "" : ` · ${pin.name}`}`,
        canExpand: ["always", "assign", "instance", "instanceArray"].includes(node.kind) }];
    });
  return { title: declared?.name ?? temporary?.name ?? context.name, span,
    fileBasename: span?.file.split("/").pop(), sourceKind: declaration ? "declaration" : "expression",
    expr: !declaration && box ? prettyNet(irId, box.contents) : undefined,
    signal: { netId, drivers: endpoints(sources, targets), loads: endpoints(targets, sources) } };
}

/** An array of this many elements or more is not expanded onto the viewer. */
const MAX_PROBE_ELEMENTS = 64;

/* The hierarchical names a waveform viewer knows a selected signal by.
 *
 * The scope path is the one the session walks, which comes from the same
 * elaboration as the dump, so the names line up. An unpacked array is the
 * shape that differs: a dump gives it a scope of its own holding the
 * elements, named by index alone because the scope already carries the array
 * name, so `wen_s[0]` is addressed as `wen_s.[0]`. Selecting one
 * branch names that element; selecting the array itself names all of them,
 * since the scope on its own is not a variable any viewer can plot.
 *
 * Empty for anything with no counterpart in a dump -- a temporary inside an
 * expanded box, or a selection that is not a signal at all.
 */
export function probeTargets(design: Design, session: ViewSession, key: string | null): string[][] {
  if (key === null) {
    return [];
  }
  const context = signalContext(design, session, key);
  if (context === null) {
    return [];
  }
  const split = context.netId.lastIndexOf("#net:");
  const irId = context.netId.slice(split + 5);
  const owner = moduleAtKey(design, session, `${context.netId.slice(0, split)}#${irId}`);
  const declared = design.modules[owner.moduleId]?.nets.find((n) => n.id === irId);
  if (declared === undefined) {
    return [];
  }
  if (declared.kind !== "memory") {
    return [[...owner.path, declared.name]];
  }
  const element = /\[\d+\]$/.exec(context.name ?? "");
  if (element !== null) {
    return [[...owner.path, declared.name, element[0]]];
  }
  const range = declared.memory?.range;
  const low = range === undefined ? 0 : Math.min(range.msb, range.lsb);
  const high = range === undefined ? (declared.memory?.depth ?? 1) - 1 : Math.max(range.msb, range.lsb);
  const indices: number[] = [];
  for (let i = low; i <= high && indices.length < MAX_PROBE_ELEMENTS; i++) {
    indices.push(i);
  }
  return indices.map((i) => [...owner.path, declared.name, `[${i}]`]);
}

export interface ProbeLocation {
  moduleId: string;
  /** Session path to the module the signal lives in. */
  path: string[];
  netId: string;
  netName: string;
}

/* Where a name from a waveform viewer lives in the design: the inverse of
 * probeTargets. Walks the instance path segment by segment, since one
 * instance can contribute several segments (a generate block and the
 * instance inside it), then takes what is left as the signal.
 *
 * Null when the name belongs to another design, or to something with no net
 * behind it.
 */
export function resolveProbePath(design: Design, instancePath: string[]): ProbeLocation | null {
  const top = design.modules[design.top];
  if (top === undefined || instancePath[0] !== top.name) {
    return null;
  }
  let moduleId = design.top;
  let path = [top.name];
  let rest = instancePath.slice(1);
  for (;;) {
    const mod = design.modules[moduleId];
    if (mod === undefined) {
      return null;
    }
    const step = mod.instances.find((i): i is typeof i & { kind: "instance" } =>
      i.kind === "instance" && i.relPath.length > 0 && i.relPath.length < rest.length &&
      i.relPath.every((part, k) => rest[k] === part));
    if (step === undefined) {
      break;
    }
    path = [...path, ...step.relPath];
    rest = rest.slice(step.relPath.length);
    moduleId = step.module;
  }
  // what remains is the signal: a name, or an array name and an element
  const name = rest.length === 1 ? rest[0]
    : rest.length === 2 && /^\[\d+\]$/.test(rest[1]) ? rest[0]
    : undefined;
  const net = name === undefined ? undefined : design.modules[moduleId]?.nets.find((n) => n.name === name);
  if (net === undefined) {
    return null;
  }
  return { moduleId, path, netId: net.id, netName: net.name };
}

/** Reveal just the route to one listed endpoint, preserving isolation and partial expansion. */
export function revealSignalConnection(design: Design, session: ViewSession, key: string, endpoint: string): ViewSession {
  const next = copySession(session);
  const context = signalContext(design, session, key);
  if (!context) return next;
  const visited = new Set(context.starts);
  const queue = [...context.starts];
  const previous = new Map<string, { pin: string; edge: typeof context.edges[number] }>();
  while (queue.length && !visited.has(endpoint)) {
    const pin = queue.shift()!;
    for (const edge of context.edges) {
      const other = edge.sourcePin === pin ? edge.targetPin : edge.targetPin === pin ? edge.sourcePin : undefined;
      if (!other || visited.has(other)) continue;
      visited.add(other);
      previous.set(other, { pin, edge });
      queue.push(other);
    }
  }
  if (!visited.has(endpoint)) return next;
  const pins = new Set([endpoint, ...context.starts]);
  for (let pin = endpoint; previous.has(pin);) {
    const step = previous.get(pin)!;
    next.revealedEdges!.add(step.edge.key);
    next.hiddenEdges?.delete(step.edge.key);
    pins.add(step.pin);
    pin = step.pin;
  }
  const reveal = (node: Level0Node): boolean => {
    const children = (node.children ?? []).filter(reveal);
    if (!children.length && !node.pins.some(p => pins.has(p.id))) return false;
    next.visible?.add(node.key);
    for (const child of children) next.partial?.get(node.key)?.add(child.key);
    return true;
  };
  // Traversal needs only the top-level roots; context.nodes also contains descendants.
  const descendants = new Set(context.nodes.flatMap(n => n.children?.map(c => c.key) ?? []));
  context.nodes.filter(n => !descendants.has(n.key)).forEach(reveal);
  return next;
}

export function selectionInfo(design: Design, session: ViewSession, key: string | null): SelectionInfo | null {
  if (key === null) {
    return null;
  }
  const signal = signalInfo(design, session, key);
  if (signal) return signal;
  const mod = design.modules[moduleAtKey(design, session, key).moduleId];
  if (mod === undefined) {
    return null;
  }
  const parsed = parseViewKey(key);
  const irId = parsed.irId;
  if (irId === mod.id) return { title: mod.name, span: mod.span, fileBasename: mod.span.file.split("/").pop() };
  if (parsed.pinName !== undefined) {
    return { title: parsed.pinName, expr: parsed.pinName };
  }
  if (irId === undefined) {
    return { title: key };
  }
  const port = mod.ports.find((p) => p.id === irId);
  if (port !== undefined) {
    return { title: port.name, span: port.span, fileBasename: port.span.file.split("/").pop() };
  }
  const box = mod.boxes.find((b) => b.id === irId);
  if (box !== undefined) {
    const out = box.ports.find((p) => p.dir === "out");
    const expr = out !== undefined ? prettyNet(out.net, box.contents) : undefined;
    return { title: box.name, span: box.span, expr, fileBasename: box.span.file.split("/").pop() };
  }
  const inst = mod.instances.find((i) => i.id === irId);
  if (inst !== undefined) {
    return { title: inst.name, span: inst.span, fileBasename: inst.span.file.split("/").pop() };
  }
  for (const b of mod.boxes) {
    const cell = b.contents.cells.find((c) => c.id === irId);
    if (cell !== undefined) {
      const expr = cell.expr ?? prettyNet(cell.pins.Y?.net ?? cell.pins.Q?.net ?? "", b.contents);
      return { title: `${cell.kind}`, span: cell.span, expr, fileBasename: cell.span.file.split("/").pop() };
    }
  }
  return { title: key };
}

export function snippet(source: string, span: SourceSpan, pad = 1): { text: string; startLine: number; hl: [number, number] } {
  const lines = source.split(/\n/);
  const from = Math.max(1, span.startLine - pad);
  const to = Math.min(lines.length, span.endLine + pad);
  return {
    text: lines.slice(from - 1, to).join("\n"),
    startLine: from,
    hl: [span.startLine, span.endLine],
  };
}
