import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLevel0Connectivity, buildVisibleConnectivity, collapseWire, defaultSession, expandHierarchy, flattenNodes, mapSymbolPoint, moduleRootKey, revealTrace, sceneEdges } from "@ossschem/graph";
import type { Design } from "@ossschem/ir";
import { describe, expect, it } from "vitest";
import { fromElkGraph, layoutLevel0 } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const design = JSON.parse(
  readFileSync(resolve(root, "fixtures/svb_afifo/golden/schematic-ir.json"), "utf8"),
) as Design;

describe("elk layout (Scene F)", () => {
  it("finishes with at least one routed edge and no throw", async () => {
    const conn = buildLevel0Connectivity(design);
    const laid = await layoutLevel0(conn.nodes, conn.edges, { timeoutMs: 10_000 });
    expect(laid.nodes.length).toBe(conn.nodes.length);
    const routed = laid.edges.filter((e) => e.points.length >= 2);
    expect(routed.length).toBeGreaterThan(0);
  });

  it("routes interior edges when a process is expanded", async () => {
    const sess = defaultSession(design);
    const full = connTop(sess);
    sess.expansion.add(full);
    const conn = buildLevel0Connectivity(design, undefined, sess);
    const laid = await layoutLevel0(conn.nodes, conn.edges, { timeoutMs: 10_000 });
    const inner = laid.nodes.find((n) => n.title === "proc_full");
    expect(inner?.children?.length).toBeGreaterThan(0);
    const interiorKeys = new Set((inner?.interiorEdges ?? []).map((e) => e.key));
    const routedInner = laid.edges.filter((e) => interiorKeys.has(e.key) && e.points.length >= 2);
    expect(routedInner.length).toBeGreaterThan(0);
    if (inner === undefined) {
      return;
    }
    const pins: { x: number; y: number }[] = [];
    for (const ch of inner.children ?? []) {
      for (const p of ch.pins) {
        pins.push({ x: inner.x + ch.x + (p.x ?? 0), y: inner.y + ch.y + (p.y ?? 0) });
      }
    }
    const near = routedInner.some((e) =>
      pins.some((pin) => {
        const p0 = e.points[0];
        const p1 = e.points[e.points.length - 1];
        return Math.min(Math.hypot(p0.x - pin.x, p0.y - pin.y), Math.hypot(p1.x - pin.x, p1.y - pin.y)) < 16;
      }),
    );
    expect(near).toBe(true);
    for (const p of inner.pins) {
      const absY = inner.y + (p.y ?? 0);
      const hits = laid.edges.some((e) =>
        e.points.some((pt) => Math.abs(pt.y - absY) < 2 && Math.abs(pt.x - (inner.x + (p.x ?? 0))) < 24),
      );
      expect(hits, `boundary pin ${p.name} should sit on a routed net`).toBe(true);
    }
    for (const e of laid.edges) {
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1];
        const b = e.points[i];
        const ortho = Math.abs(a.x - b.x) < 0.51 || Math.abs(a.y - b.y) < 0.51;
        expect(ortho).toBe(true);
      }
    }
  });
});

function connTop(sess: ReturnType<typeof defaultSession>): string {
  const conn = buildLevel0Connectivity(design, undefined, sess);
  const full = conn.nodes.find((n) => n.title === "proc_full");
  if (full === undefined) {
    throw new Error("proc_full missing");
  }
  return full.key;
}

it("lays out an instance and its expanded process with all nested wires", async () => {
  const session = defaultSession(design);
  const array = buildLevel0Connectivity(design).nodes.find(n => n.kind === "instanceArray")!;
  session.exploded.add(array.key);
  const instance = buildLevel0Connectivity(design, undefined, session).nodes.find(n => n.kind === "instance")!;
  session.expansion.add(instance.key);
  const expanded = buildLevel0Connectivity(design, undefined, session).nodes.find(n => n.key === instance.key)!;
  const process = expanded.children!.find(n => n.kind === "always")!;
  session.expansion.add(process.key);
  const graph = buildLevel0Connectivity(design, undefined, session);
  const laid = await layoutLevel0(graph.nodes, graph.edges);
  const parent = laid.nodes.find(n => n.key === instance.key)!;
  const inner = parent.children!.find(n => n.key === process.key)!;
  expect(inner.children!.length).toBeGreaterThan(0);
  // A fallback scene leaves the parent at its collapsed dimensions.
  expect(parent.w).toBeGreaterThan(instance.w);
  expect(parent.h).toBeGreaterThan(instance.h);
  for (const edge of inner.interiorEdges!) {
    expect(laid.edges.some(w => w.key === edge.key)).toBe(true);
  }
  for (const child of parent.children!) {
    expect(child.x).toBeGreaterThan(0);
    expect(child.x + child.w).toBeLessThan(parent.w);
    expect(child.y + child.h).toBeLessThan(parent.h);
  }
});

it("keeps expanded boundary labels at least 24 units apart", async () => {
  const session = defaultSession(design);
  const process = buildLevel0Connectivity(design).nodes.find(n => n.title === "proc_r_pointer")!;
  session.expansion.add(process.key);
  const graph = buildLevel0Connectivity(design, undefined, session);
  const laid = await layoutLevel0(graph.nodes, graph.edges);
  const expanded = laid.nodes.find(n => n.key === process.key)!;
  expect(expanded.w).toBeGreaterThan(process.w);
  for (const side of ["W", "E"]) {
    const ys = expanded.pins.filter(p => p.side === side).map(p => p.y!).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(24);
  }
  const pinIds = new Set(expanded.children!.flatMap(n => n.pins.map(p => p.id)));
  expect(laid.edges.some(e => pinIds.has(e.targetPin))).toBe(true);
});

it("keeps every primary input left and output right, including disconnected clock ports", async () => {
  const session = defaultSession(design);
  const process = buildLevel0Connectivity(design).nodes.find(n => n.title === "proc_r_pointer")!;
  session.expansion.add(process.key);
  const graph = buildLevel0Connectivity(design, undefined, session);
  const laid = await layoutLevel0(graph.nodes, graph.edges);
  const logic = laid.nodes.filter(n => n.kind !== "port");
  const left = Math.min(...logic.map(n => n.x));
  const right = Math.max(...logic.map(n => n.x + n.w));
  for (const node of laid.nodes.filter(n => n.kind === "port")) {
    if (node.badge === "in") expect(node.x + node.w, node.title).toBeLessThan(left);
    else expect(node.x, node.title).toBeGreaterThan(right);
  }
  expect(laid.nodes.find(n => n.key === process.key)!.w).toBeGreaterThan(process.w);
});

it("preserves wire widths through routing", async () => {
  const graph = buildLevel0Connectivity(design);
  const laid = await layoutLevel0(graph.nodes, graph.edges);
  const bus = laid.edges.find(e => e.netName === "wdata_i")!;
  expect(bus.width).toBe(32);
  expect(bus.points.length).toBeGreaterThanOrEqual(2);
  expect(laid.edges.find(e => e.netName === "full_s")!.width).toBe(1);
});

it("attaches memory read and write output wires to the drawn symbol edge", async () => {
  const session = defaultSession(design);
  const processes = buildLevel0Connectivity(design).nodes.filter(n =>
    n.title === "proc_fifo_mem_w" || n.title === "proc_fifo_mem_r");
  expect(processes).toHaveLength(2);
  for (const process of processes) session.expansion.add(process.key);
  const graph = buildLevel0Connectivity(design, undefined, session);
  const laid = await layoutLevel0(graph.nodes, graph.edges);
  for (const kind of ["memwr", "memrd"]) {
    const parent = laid.nodes.find(n => n.children?.some(c => c.symbol === kind))!;
    const memory = parent.children!.find(n => n.symbol === kind)!;
    const pin = memory.pins.find(p => p.name === (kind === "memwr" ? "Q" : "Y"))!;
    const glyphEdge = mapSymbolPoint(66, 40, memory.w, memory.symbolHeight ?? memory.h);
    expect(pin.x).toBeCloseTo(glyphEdge.x);
    expect(pin.y).toBeCloseTo(glyphEdge.y);
    const wires = laid.edges.filter(e => e.sourcePin === pin.id);
    expect(wires.length).toBeGreaterThan(0);
    for (const wire of wires) {
      const start = wire.points[0];
      expect(Math.abs(start.x - (parent.x + memory.x + glyphEdge.x))).toBeLessThan(1);
      expect(Math.abs(start.y - (parent.y + memory.y + glyphEdge.y))).toBeLessThan(1);
    }
  }
});

it("keeps ports clear of lower borders in collapsed, expanded, and fallback scenes", async () => {
  const session = defaultSession(design);
  const top = buildLevel0Connectivity(design);
  const check = (nodes: typeof top.nodes): void => {
    for (const node of flattenNodes(nodes).filter(n => n.kind !== "primitive")) {
      for (const pin of node.pins) {
        if (node.kind === "port") expect(pin.y, `${node.title} is centered on the port shape`).toBeCloseTo(node.h / 2);
        else expect(pin.y, `${node.title}.${pin.name} clears the header`).toBeGreaterThanOrEqual(40);
        expect(node.h - pin.y!, `${node.title}.${pin.name} clears the bottom`).toBeGreaterThanOrEqual(24);
      }
    }
  };
  check((await layoutLevel0(top.nodes, top.edges)).nodes);
  check(fromElkGraph({ id: "root" }, top.nodes, top.edges).nodes);
  const process = top.nodes.find(n => n.title === "proc_r_pointer")!;
  session.expansion.add(process.key);
  const array = top.nodes.find(n => n.kind === "instanceArray")!;
  session.exploded.add(array.key);
  const member = buildLevel0Connectivity(design, undefined, session).nodes.find(n => n.kind === "instance")!;
  session.expansion.add(member.key);
  const graph = buildLevel0Connectivity(design, undefined, session);
  const laid = await layoutLevel0(graph.nodes, graph.edges);
  expect(laid.nodes.find(n => n.key === process.key)!.w).toBeGreaterThan(process.w);
  check(laid.nodes);
});

it("connects directional input, output, and inout port shapes at their midline", async () => {
  const copy = structuredClone(design);
  copy.modules[copy.top].ports.find(p => p.name === "full_o")!.dir = "inout";
  const graph = buildLevel0Connectivity(copy);
  const laid = await layoutLevel0(graph.nodes, graph.edges);
  for (const [name, badge, side] of [["ren_i", "in", "E"], ["empty_o", "out", "W"], ["full_o", "inout", "W"]]) {
    const node = laid.nodes.find(n => n.title === name)!;
    const pin = node.pins[0];
    expect(node.badge).toBe(badge);
    expect(pin.side).toBe(side);
    expect(pin.y).toBeCloseTo(node.h / 2);
    expect(pin.x).toBeCloseTo(side === "E" ? node.w : 0);
    const wires = laid.edges.filter(e => e.sourcePin === pin.id || e.targetPin === pin.id);
    expect(wires.length).toBeGreaterThan(0);
    for (const wire of wires) {
      const end = wire.sourcePin === pin.id ? wire.points[0] : wire.points.at(-1)!;
      expect(Math.abs(end.x - node.x - pin.x!)).toBeLessThan(1);
      expect(Math.abs(end.y - node.y - pin.y!)).toBeLessThan(1);
    }
  }
});

it("routes the complete module after expanding all hierarchy and process logic", async () => {
  const session = defaultSession(design);
  const expanded = expandHierarchy(design, session, moduleRootKey(session), "logic");
  const graph = buildVisibleConnectivity(design, expanded);
  const laid = await layoutLevel0(graph.nodes, graph.edges);
  const expectedEdges = sceneEdges(graph);
  expect(laid.edges).toHaveLength(expectedEdges.length);
  for (const node of flattenNodes(laid.nodes).filter(n => n.children?.length)) {
    for (const child of node.children!) {
      expect(child.x, node.title).toBeGreaterThan(0);
      expect(child.x + child.w, node.title).toBeLessThan(node.w);
      expect(child.y + child.h, node.title).toBeLessThan(node.h);
    }
  }
  for (const wire of laid.edges) {
    expect(wire.points.length).toBeGreaterThanOrEqual(2);
    for (const point of wire.points) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  }
});

it("aligns input connection tips with and without visible wires, including fallback layout", async () => {
  const session = defaultSession(design);
  const initial = buildVisibleConnectivity(design, session);
  const clock = initial.nodes.find(n => n.title === "clk_r_i")!;
  const data = initial.edges.find(e => e.netName === "wdata_i")!;
  const variants = [session, revealTrace(design, session, clock.key, "forward"), collapseWire(session, data.key)];
  for (const current of variants) {
    const graph = buildVisibleConnectivity(design, current);
    for (const laid of [await layoutLevel0(graph.nodes, graph.edges), fromElkGraph({ id: "root" }, graph.nodes, graph.edges)]) {
      const inputs = laid.nodes.filter(n => n.kind === "port" && n.badge === "in");
      expect(new Set(inputs.map(n => n.w)).size).toBeGreaterThan(1);
      const tip = inputs[0].x + inputs[0].w;
      for (const port of inputs) {
        expect(port.x + port.w).toBeCloseTo(tip);
        const wires = laid.edges.filter(e => e.sourcePin === port.pins[0].id);
        for (const wire of wires) {
          expect(wire.points[0].x).toBeCloseTo(tip);
          expect(wire.points[1].x).toBeGreaterThanOrEqual(tip);
        }
      }
    }
  }
});

it("aligns outputs and inouts when connected, collapsed, and revealed again", async () => {
  const copy = structuredClone(design);
  copy.modules[copy.top].ports.find(p => p.name === "full_o")!.dir = "inout";
  const session = defaultSession(copy);
  const initial = buildVisibleConnectivity(copy, session);
  const inout = initial.nodes.find(n => n.title === "full_o")!;
  const output = initial.nodes.find(n => n.title === "rdata_o")!;
  const inoutWire = initial.edges.find(e => e.targetKey === inout.key)!;
  const outputWire = initial.edges.find(e => e.targetKey === output.key)!;
  const bothHidden = collapseWire(collapseWire(session, inoutWire.key), outputWire.key);
  const restored = revealTrace(copy, revealTrace(copy, bothHidden, inout.key, "back"), output.key, "back");
  const variants = [session, collapseWire(session, inoutWire.key), collapseWire(session, outputWire.key), bothHidden, restored];
  for (const current of variants) {
    const graph = buildVisibleConnectivity(copy, current);
    for (const laid of [await layoutLevel0(graph.nodes, graph.edges), fromElkGraph({ id: "root" }, graph.nodes, graph.edges)]) {
      const ports = laid.nodes.filter(n => n.kind === "port" && n.badge !== "in");
      expect(ports.some(n => n.badge === "inout")).toBe(true);
      expect(new Set(ports.map(n => n.w)).size).toBeGreaterThan(1);
      const connectionX = ports[0].x;
      for (const port of ports) {
        expect(port.x + port.pins[0].x!, port.title).toBeCloseTo(connectionX);
        for (const wire of laid.edges.filter(e => e.targetPin === port.pins[0].id)) {
          expect(wire.points.at(-1)!.x).toBeCloseTo(connectionX);
          expect(wire.points.at(-2)!.x).toBeLessThanOrEqual(connectionX);
          expect(Math.abs(wire.points.at(-1)!.y - port.y - port.pins[0].y!)).toBeLessThan(1);
        }
      }
    }
  }
});
