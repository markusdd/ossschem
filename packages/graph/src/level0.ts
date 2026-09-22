import type { AlwaysBox, AssignBox, Design, Instance, InstanceArray, Module, Primitive, Net, ViewId } from "@ossschem/ir";
import { viewIdKey } from "@ossschem/ir";
import { combinedWidth, connectionWidth, referenceWidth } from "./width.js";
import { defaultSession, type ViewSession } from "./session.js";

export type Level0Kind = "port" | "open" | "always" | "assign" | "instanceArray" | "instance" | "primitive" | "split";

/* An open end is laid out and labelled like a port -- it is where a signal
 * enters or leaves the drawing -- but it is not a declared port, so it is
 * drawn as a plain box rather than a directional one. */
export function isPortLike(kind: Level0Kind): boolean {
  return kind === "port" || kind === "open";
}

export interface Pin {
  id: string;
  name: string;
  side: "W" | "E";
  netId: string;
  netName: string;
  width?: number;
  /** Shown in place of the bit count, for a signal that is not one wide value. */
  widthText?: string;
  /** Index into an unpacked array, when this pin connects to one element of it. */
  element?: number;
  collapsed?: boolean;
  handles?: { inside: boolean; outside: boolean };
  x?: number;
  y?: number;
}

export interface Level0Node {
  key: string;
  id: ViewId;
  kind: Level0Kind;
  title: string;
  badge?: string;
  symbol?: string;
  /** Glyph viewport height; the remaining node height reserves space for its caption. */
  symbolHeight?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  pins: Pin[];
  children?: Level0Node[];
  interiorEdges?: Level0Edge[];
  /** Box to expand when this node's pin is double-clicked. */
  expandKey?: string;
}

export interface Level0Edge {
  key: string;
  stubbed?: boolean;
  width?: number;
  /** Shown in place of the width, for a connection the bit count does not describe. */
  widthText?: string;
  /** The array element this connection carries, for a branch off a splitter. */
  element?: number;
  netName: string;
  netId: string;
  sourceKey: string;
  targetKey: string;
  sourcePin: string;
  targetPin: string;
}

const PIN_PITCH = 28;
const PIN_TOP = 40;

export function pinId(nodeKey: string, pinName: string): string {
  return `${nodeKey}::${pinName}`;
}

export function parseViewKey(key: string): { nodeKey: string; irId: string | undefined; pinName?: string } {
  const [nodeKey, pinName] = key.split("::");
  const hash = nodeKey.lastIndexOf("#");
  return {
    nodeKey,
    irId: hash < 0 ? undefined : nodeKey.slice(hash + 1),
    pinName,
  };
}

export function pinLabel(pin: Pin): string {
  const width = pin.widthText ?? (pin.width !== undefined && pin.width > 1 ? `${pin.width}b` : undefined);
  return `${pin.name}${width === undefined ? "" : ` · ${width}`}`;
}

/* An unpacked array is several signals under one name, so its size is a count
 * of elements and their width, not a single bit count. */
export function arrayShape(net: Net | undefined): string | undefined {
  if (net?.kind !== "memory" || net.memory === undefined) {
    return undefined;
  }
  const packed = net.memory.packed;
  return `${net.memory.depth}\u00d7${Math.abs(packed.msb - packed.lsb) + 1}b`;
}

export function sizeFromPins(pins: Pin[], minW = 168): { w: number; h: number } {
  const west = pins.filter((p) => p.side === "W").length;
  const east = pins.filter((p) => p.side === "E").length;
  return {
    w: Math.max(minW, 40 + Math.max(0, ...pins.filter(p => p.side === "W").map(p => pinLabel(p).length * 7)) + Math.max(0, ...pins.filter(p => p.side === "E").map(p => pinLabel(p).length * 7))),
    h: Math.max(44, PIN_TOP + PIN_PITCH * Math.max(west, east, 1) + 8),
  };
}

function placePins(pins: Pin[], w: number): Pin[] {
  let wi = 0;
  let ei = 0;
  return pins.map((p) => {
    if (p.side === "W") {
      const y = PIN_TOP + wi * PIN_PITCH;
      wi += 1;
      return { ...p, x: 0, y };
    }
    const y = PIN_TOP + ei * PIN_PITCH;
    ei += 1;
    return { ...p, x: w, y };
  });
}

function netName(mod: Module, id: string): string {
  return mod.nets.find((n) => n.id === id)?.name ?? id;
}

export function clockResetNetIds(mod: Module): Set<string> {
  const ids = new Set<string>();
  for (const box of mod.boxes) {
    if (box.kind !== "always") {
      continue;
    }
    for (const s of [...box.clocks, ...box.resets]) {
      ids.add(s.net);
    }
  }
  return ids;
}

function pinsForBox(
  key: string,
  box: AlwaysBox | AssignBox,
  mod: Module,
  collapsed: Set<string>,
): Pin[] {
  const pins: Pin[] = [];
  for (const p of box.ports) {
    pins.push({
      id: pinId(key, p.name),
      name: p.name,
      side: p.dir === "out" ? "E" : "W",
      netId: p.net,
      width: referenceWidth(p, mod.nets),
      netName: netName(mod, p.net),
      collapsed: collapsed.has(p.net),
    });
  }
  return pins;
}

function pinsForInstance(
  key: string,
  inst: Instance,
  parent: Module,
  childMod: Module | undefined,
  collapsed: Set<string>,
): Pin[] {
  return inst.pins.map((p) => {
    const childPort = childMod?.ports.find((x) => x.name === p.port);
    return {
      id: pinId(key, p.port),
      name: p.port,
      side: childPort?.dir === "output" ? "E" : "W",
      netId: p.net,
      width: referenceWidth(p, parent.nets),
      netName: netName(parent, p.net) + (p.element === undefined ? "" : `[${p.element}]`),
      element: p.element,
      collapsed: collapsed.has(p.net),
    };
  });
}

function pinsForArray(
  key: string,
  arr: InstanceArray,
  parent: Module,
  childMod: Module | undefined,
  collapsed: Set<string>,
): Pin[] {
  const member = parent.instances.find((i) => i.kind === "instance" && i.id === arr.members[0]);
  if (member === undefined || member.kind !== "instance") {
    return [];
  }
  return pinsForInstance(key, member, parent, childMod, collapsed).map(pin => {
    const refs = parent.instances.flatMap(inst => inst.kind === "instance" && arr.members.includes(inst.id)
      ? inst.pins.filter(p => p.port === pin.name && p.net === pin.netId) : []);
    // the folded array stands for every member, so its pins name no one element
    return { ...pin, element: undefined, width: combinedWidth(refs, parent.nets) };
  });
}

const WEST_PINS = new Set(["A", "B", "D", "S", "EN", "CLK", "ARST", "WE", "ADDR", "MEM"]);

function pinsForPrimitive(key: string, cell: Primitive, mod: Module, collapsed: Set<string>, localNets: Net[]): Pin[] {
  const pins: Pin[] = [];
  for (const [name, ref] of Object.entries(cell.pins)) {
    if (name === "Y" || name === "Q") {
      pins.push({
        id: pinId(key, name),
        name,
        side: "E",
        netId: ref.net,
        width: referenceWidth(ref, [...localNets, ...mod.nets]),
        netName: netName(mod, ref.net),
        collapsed: collapsed.has(ref.net),
      });
      continue;
    }
    const west = WEST_PINS.has(name) || name.startsWith("A");
    pins.push({
      id: pinId(key, name),
      name,
      side: west ? "W" : "E",
      netId: ref.net,
      width: referenceWidth(ref, [...localNets, ...mod.nets]),
      netName: netName(mod, ref.net),
      collapsed: collapsed.has(ref.net),
    });
  }
  const order = { W: 0, E: 1 };
  pins.sort((a, b) => order[a.side] - order[b.side] || a.name.localeCompare(b.name));
  return pins;
}

function primitiveTitle(cell: Primitive, mod: Module): { title: string; badge: string } {
  const q = cell.pins.Q?.net ?? cell.pins.Y?.net;
  const qName = mod.nets.find((n) => n.id === q)?.name;
  if (qName !== undefined && !qName.startsWith("t")) {
    return { title: qName, badge: "" };
  }
  return { title: "", badge: "" };
}

function symbolMin(kind: string | undefined): { w: number; h: number } {
  switch (kind) {
    case "not":
    case "buf":
      return { w: 56, h: 48 };
    case "and":
    case "or":
    case "xor":
      return { w: 64, h: 52 };
    case "mux":
      return { w: 56, h: 64 };
    case "dff":
    case "adff":
    case "dffe":
    case "adffe":
      return { w: 72, h: 80 };
    case "memrd":
    case "memwr":
      return { w: 96, h: 80 };
    default:
      return { w: 64, h: 52 };
  }
}

function finishNode(n: Omit<Level0Node, "w" | "h" | "x" | "y" | "pins"> & { pins: Pin[] }): Level0Node {
  if (n.kind === "port") {
    const w = Math.max(120, ...n.pins.map(p => pinLabel(p).length * 8 + 56));
    return { ...n, x: 0, y: 0, w, h: 48,
      pins: n.pins.map(p => ({ ...p, x: p.side === "W" ? 0 : w, y: 24 })) };
  }
  const fromPins = sizeFromPins(n.pins);
  const fromSym = symbolMin(n.symbol);
  const caption = n.kind === "primitive" && n.title.length > 0;
  const w = Math.max(fromPins.w, fromSym.w, n.symbol ? (caption ? n.title.length * 7 + 16 : 0) : n.title.length * 8 + (n.badge?.length ?? 0) * 7 + 50);
  const glyphHeight = Math.max(fromPins.h, fromSym.h);
  const h = glyphHeight + (caption ? 20 : 0);
  return { ...n, x: 0, y: 0, w, h, symbolHeight: caption ? glyphHeight : undefined, pins: placePins(n.pins, w) };
}

function interior(box: AlwaysBox | AssignBox, boxKey: string, path: string[], mod: Module): {
  children: Level0Node[];
  interiorEdges: Level0Edge[];
} {
  const children: Level0Node[] = [];
  for (const cell of box.contents.cells) {
    if (cell.kind === "const") {
      continue;
    }
    const id = { path: [...path, box.name], irId: cell.id };
    const key = viewIdKey(id);
    const { title, badge } = primitiveTitle(cell, mod);
    children.push(
      finishNode({
        key,
        id,
        kind: "primitive",
        title,
        badge,
        pins: pinsForPrimitive(key, cell, mod, new Set(), box.contents.nets),
        symbol: cell.kind,
        expandKey: boxKey,
      }),
    );
  }
  const interiorEdges: Level0Edge[] = [];
  const drivers = new Map<string, { nodeKey: string; pin: Pin }[]>();
  const loads = new Map<string, { nodeKey: string; pin: Pin }[]>();
  for (const ch of children) {
    for (const p of ch.pins) {
      const bucket = p.side === "E" ? drivers : loads;
      const list = bucket.get(p.netId) ?? [];
      list.push({ nodeKey: ch.key, pin: p });
      bucket.set(p.netId, list);
    }
  }
  const boundary = new Map(box.ports.map((p) => [p.net, pinId(boxKey, p.name)]));
  let i = 0;
  const nets = new Set([...drivers.keys(), ...loads.keys(), ...boundary.keys()]);
  for (const netId of nets) {
    const name = netName(mod, netId);
    const ds = drivers.get(netId) ?? [];
    const ls = loads.get(netId) ?? [];
    const bound = boundary.get(netId);
    if (bound !== undefined) {
      const port = box.ports.find((p) => p.net === netId);
      if (port?.dir === "in") {
        for (const l of ls) {
          interiorEdges.push({
            key: `${boxKey}:in:${i++}`,
            width: connectionWidth(referenceWidth(port, mod.nets), l.pin.width),
            netName: name,
            netId,
            sourceKey: boxKey,
            targetKey: l.nodeKey,
            sourcePin: bound,
            targetPin: l.pin.id,
          });
        }
      } else {
        for (const d of ds) {
          interiorEdges.push({
            key: `${boxKey}:out:${i++}`,
            width: connectionWidth(d.pin.width, port && referenceWidth(port, mod.nets)),
            netName: name,
            netId,
            sourceKey: d.nodeKey,
            targetKey: boxKey,
            sourcePin: d.pin.id,
            targetPin: bound,
          });
        }
      }
    }
    for (const d of ds) {
      for (const l of ls) {
        if (d.nodeKey === l.nodeKey) {
          continue;
        }
        interiorEdges.push({
          key: `${boxKey}:t:${i++}`,
          width: connectionWidth(d.pin.width, l.pin.width),
          netName: name,
          netId,
          sourceKey: d.nodeKey,
          targetKey: l.nodeKey,
          sourcePin: d.pin.id,
          targetPin: l.pin.id,
        });
      }
    }
  }
  return { children, interiorEdges };
}

export function buildLevel0(design: Design, mod?: Module, session?: ViewSession): Level0Node[] {
  const sess = session ?? defaultSession(design);
  const module = mod ?? design.modules[sess.moduleId] ?? design.modules[design.top];
  const path = sess.path;
  const collapsed = clockResetNetIds(module);
  const nodes: Level0Node[] = [];

  const inputs = module.ports.filter((p) => p.dir === "input");
  const outputs = module.ports.filter((p) => p.dir === "output" || p.dir === "inout");

  for (const port of inputs) {
    const id = { path, irId: port.id };
    const key = viewIdKey(id);
    nodes.push(
      finishNode({
        key,
        id,
        kind: "port",
        title: port.name,
        badge: "in",
        pins: [
          {
            id: pinId(key, port.name),
            name: port.name,
            side: "E",
            netId: port.net,
            netName: port.name,
            width: referenceWidth({ net: port.net }, module.nets),
            widthText: arrayShape(module.nets.find((n) => n.id === port.net)),
            collapsed: collapsed.has(port.net),
          },
        ],
      }),
    );
  }

  for (const box of module.boxes) {
    const id = { path, irId: box.id };
    const key = viewIdKey(id);
    const pins = pinsForBox(key, box, module, collapsed);
    const node = finishNode({
      key,
      id,
      kind: box.kind,
      title: box.name,
      badge: box.kind === "always" ? (box.keyword === "always_ff" ? "ff" : "comb") : "assign",
      pins,
    });
    if (sess.expansion.has(key) && box.contents.cells.length > 0) {
      const inner = interior(box, key, path, module);
      node.children = inner.children;
      node.interiorEdges = inner.interiorEdges;
    }
    nodes.push(node);
  }

  const arrays = module.instances.filter((i) => i.kind === "instanceArray");
  for (const arr of arrays) {
    const id = { path, irId: arr.id };
    const arrKey = viewIdKey(id);
    if (sess.exploded.has(arrKey)) {
      for (const mid of arr.members) {
        const inst = module.instances.find((i) => i.kind === "instance" && i.id === mid);
        if (inst === undefined || inst.kind !== "instance") {
          continue;
        }
        const iid = { path, irId: inst.id };
        const key = viewIdKey(iid);
        nodes.push(
          finishNode({
            key,
            id: iid,
            kind: "instance",
            title: `${inst.name}[${inst.arrayIndex ?? 0}]`,
            badge: "sync",
            pins: pinsForInstance(key, inst, module, design.modules[inst.module], collapsed),
          }),
        );
      }
      continue;
    }
    nodes.push(
      finishNode({
        key: arrKey,
        id,
        kind: "instanceArray",
        title: arr.name,
        badge: `[${arr.range.msb}:${arr.range.lsb}]`,
        pins: pinsForArray(arrKey, arr, module, design.modules[arr.module], collapsed),
      }),
    );
  }

  const members = new Set(arrays.flatMap((a) => a.members));
  for (const inst of module.instances) {
    if (inst.kind !== "instance" || members.has(inst.id)) continue;
    const id = { path, irId: inst.id };
    const key = viewIdKey(id);
    nodes.push(finishNode({ key, id, kind: "instance", title: inst.name,
      badge: design.modules[inst.module]?.name ?? "instance",
      pins: pinsForInstance(key, inst, module, design.modules[inst.module], collapsed) }));
  }

  /* Nets connected on one side only: something outside the module drives or
   * reads them -- a testbench signal driven by the simulator, for instance.
   * Without a box to land on, the pins that use them are left labelled but
   * unconnected, so give them one. A net with nothing on either side has no
   * connection to show and is left out. */
  const portNets = new Set(module.ports.map((p) => p.net));
  for (const net of module.nets) {
    if (portNets.has(net.id)) continue;
    if ((net.drivers.length === 0) === (net.loads.length === 0)) continue;
    const entering = net.drivers.length === 0;
    const id = { path, irId: net.id };
    const key = viewIdKey(id);
    nodes.push(
      finishNode({
        key,
        id,
        kind: "open",
        title: net.name,
        // placement only: a port-like node draws its name, not its badge
        badge: entering ? "in" : "out",
        pins: [
          {
            id: pinId(key, net.name),
            name: net.name,
            side: entering ? "E" : "W",
            netId: net.id,
            netName: net.name,
            width: referenceWidth({ net: net.id }, module.nets),
            widthText: arrayShape(net),
            collapsed: collapsed.has(net.id),
          },
        ],
      }),
    );
  }

  for (const port of outputs) {
    const id = { path, irId: port.id };
    const key = viewIdKey(id);
    nodes.push(
      finishNode({
        key,
        id,
        kind: "port",
        title: port.name,
        badge: port.dir === "inout" ? "inout" : "out",
        pins: [
          {
            id: pinId(key, port.name),
            name: port.name,
            side: "W",
            netId: port.net,
            netName: port.name,
            width: referenceWidth({ net: port.net }, module.nets),
            widthText: arrayShape(module.nets.find((n) => n.id === port.net)),
            collapsed: collapsed.has(port.net),
          },
        ],
      }),
    );
  }

  return placeColumns(nodes);
}

function placeColumns(nodes: Level0Node[]): Level0Node[] {
  const ins = nodes.filter((n) => n.kind === "port" && n.badge === "in");
  const outs = nodes.filter((n) => n.kind === "port" && n.badge !== "in");
  const mid = nodes.filter((n) => n.kind !== "port");
  const stack = (list: Level0Node[], x: number): void => {
    let y = 24;
    for (const n of list) {
      n.x = x;
      n.y = y;
      y += n.h + 16;
    }
  };
  stack(ins, 24);
  stack(mid, 220);
  stack(outs, 460);
  return nodes;
}
