import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Design } from "@ossschem/ir";
import {
  buildLevel0Connectivity, buildVisibleConnectivity, defaultSession, expandComponent,
  flattenNodes, isolateComponent, pinTraceDirection, revealTrace, sceneEdges,
  collapseWire, revealSignalConnection, expandHierarchy, sessionKey,
} from "../src/index.js";

const design = JSON.parse(readFileSync(new URL("../../../fixtures/svb_afifo/golden/schematic-ir.json", import.meta.url), "utf8")) as Design;
const session = defaultSession(design);
const initial = buildLevel0Connectivity(design);
const process = initial.nodes.find(n => n.title === "proc_r_pointer")!;
const input = process.pins.find(p => p.name === "ren_i")!;

it("isolates a selected component or pin without losing hidden connectivity", () => {
  const isolated = isolateComponent(design, session, input.id);
  const graph = buildVisibleConnectivity(design, isolated);
  expect(graph.nodes.map(n => n.key)).toEqual([process.key]);
  expect(graph.edges).toEqual([]);
  expect(graph.nodes[0].pins.find(p => p.id === input.id)?.handles).toEqual({ inside: true, outside: true });
  expect(session.visible).toBeUndefined();
});

it("reveals inside and outside independently and retains the other handle", () => {
  let current = isolateComponent(design, session, process.key);
  current = revealTrace(design, current, input.id, "forward", "inside");
  let graph = buildVisibleConnectivity(design, current);
  expect(graph.nodes.map(n => n.key)).toEqual([process.key]);
  expect(graph.nodes[0].children!.length).toBeGreaterThan(0);
  expect(graph.nodes[0].pins.find(p => p.id === input.id)?.handles).toEqual({ inside: false, outside: true });
  const children = graph.nodes[0].children!.map(n => n.key);

  current = revealTrace(design, current, input.id, "back", "outside");
  graph = buildVisibleConnectivity(design, current);
  expect(graph.nodes.some(n => n.kind === "port" && n.title === "ren_i")).toBe(true);
  expect(graph.nodes.some(n => n.title === "proc_empty")).toBe(false);
  const visibleProcess = graph.nodes.find(n => n.key === process.key)!;
  expect(visibleProcess.children!.map(n => n.key)).toEqual(children);
  expect(visibleProcess.pins.find(p => p.id === input.id)?.handles).toEqual({ inside: false, outside: false });
});

it("outside expansion does not open the selected process", () => {
  const isolated = isolateComponent(design, session, process.key);
  const current = revealTrace(design, isolated, input.id, "back", "outside");
  const graph = buildVisibleConnectivity(design, current);
  const visibleProcess = graph.nodes.find(n => n.key === process.key)!;
  expect(visibleProcess.children).toBeUndefined();
  expect(visibleProcess.pins.find(p => p.id === input.id)?.handles).toEqual({ inside: true, outside: false });
});

it("retains the outside clock handle when only its internal wires are displayed", () => {
  const expanded = expandComponent(design, session, process.key);
  let graph = buildVisibleConnectivity(design, expanded);
  let clock = graph.nodes.find(n => n.key === process.key)!.pins.find(p => p.name === "clk_r_i")!;
  expect(clock.handles).toEqual({ inside: false, outside: true });
  const current = revealTrace(design, expanded, clock.id, "back", "outside");
  graph = buildVisibleConnectivity(design, current);
  clock = graph.nodes.find(n => n.key === process.key)!.pins.find(p => p.name === "clk_r_i")!;
  expect(clock.handles).toEqual({ inside: false, outside: false });
  const otherClock = graph.nodes.flatMap(n => n.pins).find(p => p.name === "clk_w_i" && p.side === "W")!;
  expect(otherClock.handles?.outside).toBe(true);
});

it("can isolate an internal gate, retain its enclosing boundary, then restore all", () => {
  const expanded = expandComponent(design, session, process.key);
  const child = flattenNodes(buildLevel0Connectivity(design, undefined, expanded).nodes).find(n => n.kind === "primitive")!;
  const isolated = isolateComponent(design, expanded, child.key);
  const graph = buildVisibleConnectivity(design, isolated);
  expect(graph.nodes).toHaveLength(1);
  expect(graph.nodes[0].children!.map(n => n.key)).toEqual([child.key]);
  const restored = buildVisibleConnectivity(design, { ...isolated, visible: undefined });
  expect(restored.nodes).toHaveLength(initial.nodes.length);
  const keys = new Set(flattenNodes(graph.nodes).map(n => n.key));
  for (const e of sceneEdges(graph)) {
    expect(keys.has(e.sourceKey)).toBe(true);
    expect(keys.has(e.targetKey)).toBe(true);
  }
});

it("can explode an isolated array without losing its member instances", () => {
  const array = initial.nodes.find(n => n.kind === "instanceArray")!;
  const isolated = isolateComponent(design, session, array.key);
  const exploded = expandComponent(design, isolated, array.key);
  const graph = buildVisibleConnectivity(design, exploded);
  expect(graph.nodes.length).toBeGreaterThan(1);
  expect(graph.nodes.every(n => n.kind === "instance")).toBe(true);
});

describe("handle directions", () => {
  it("reverses direction between the inside and outside faces", () => {
    expect(pinTraceDirection("W", "outside")).toBe("back");
    expect(pinTraceDirection("W", "inside")).toBe("forward");
    expect(pinTraceDirection("E", "outside")).toBe("forward");
    expect(pinTraceDirection("E", "inside")).toBe("back");
  });
});

it("traces an output inward to its driver and outward to its loads", () => {
  const output = process.pins.find(p => p.name === "bin_rpointer_r")!;
  let current = isolateComponent(design, session, process.key);
  current = revealTrace(design, current, output.id, "back", "inside");
  let graph = buildVisibleConnectivity(design, current);
  expect(graph.nodes).toHaveLength(1);
  const open = graph.nodes[0];
  expect(open.children!.some(n => n.symbol?.includes("dff"))).toBe(true);
  expect(open.pins.find(p => p.id === output.id)?.handles).toEqual({ inside: false, outside: true });
  current = revealTrace(design, current, output.id, "forward", "outside");
  graph = buildVisibleConnectivity(design, current);
  expect(graph.nodes.length).toBeGreaterThan(1);
  expect(graph.nodes.find(n => n.key === process.key)!.pins.find(p => p.id === output.id)?.handles).toEqual({ inside: false, outside: false });
  expect(graph.nodes.some(n => n.title === "proc_w_pointer")).toBe(false);
});

it("traces only one internal branch in the full module view, then expands all separately", () => {
  let current = revealTrace(design, session, input.id, "forward", "inside");
  const fullChildren = buildLevel0Connectivity(design, undefined, current).nodes.find(n => n.key === process.key)!.children!;
  let graph = buildVisibleConnectivity(design, current);
  let partial = graph.nodes.find(n => n.key === process.key)!;
  expect(current.visible).toBeUndefined();
  expect(graph.nodes).toHaveLength(initial.nodes.length);
  expect(partial.children!.length).toBeGreaterThan(0);
  expect(partial.children!.length).toBeLessThan(fullChildren.length);
  const firstBranch = partial.children!.map(n => n.key);
  const output = process.pins.find(p => p.name === "bin_rpointer_r")!;
  current = revealTrace(design, current, output.id, "back", "inside");
  graph = buildVisibleConnectivity(design, current);
  partial = graph.nodes.find(n => n.key === process.key)!;
  for (const key of firstBranch) expect(partial.children!.some(n => n.key === key)).toBe(true);
  expect(partial.children!.length).toBeLessThan(fullChildren.length);
  current = expandComponent(design, current, process.key);
  expect(current.expansion.has(process.key)).toBe(true);
  expect(current.partial?.has(process.key)).toBe(false);
  expect(buildVisibleConnectivity(design, current).nodes.find(n => n.key === process.key)!.children).toHaveLength(fullChildren.length);
});

it("collapses just the selected wire, restores handles, and allows tracing it again", () => {
  const before = buildVisibleConnectivity(design, session);
  const wire = before.edges.find(e => e.targetPin === input.id)!;
  const sibling = before.edges.find(e => e.sourcePin === wire.sourcePin && e.key !== wire.key)!;
  expect(sibling).toBeDefined();
  const collapsed = collapseWire(session, wire.key);
  expect(sessionKey(collapsed)).not.toBe(sessionKey(session));
  expect(session.hiddenEdges).toBeUndefined();
  const after = buildVisibleConnectivity(design, collapsed);
  expect(after.edges.map(e => e.key)).toEqual(before.edges.filter(e => e.key !== wire.key).map(e => e.key));
  expect(after.nodes.map(n => n.key)).toEqual(before.nodes.map(n => n.key));
  for (const pin of [wire.sourcePin, wire.targetPin]) {
    expect(after.nodes.flatMap(n => n.pins).find(p => p.id === pin)!.handles?.outside).toBe(true);
  }
  const restored = revealTrace(design, collapsed, wire.targetPin, "back", "outside");
  expect(buildVisibleConnectivity(design, restored).edges.some(e => e.key === wire.key)).toBe(true);
  const fromPane = revealSignalConnection(design, collapsed, wire.sourcePin, wire.targetPin);
  expect(buildVisibleConnectivity(design, fromPane).edges.some(e => e.key === wire.key)).toBe(true);
});

it("collapses a previously revealed clock branch without hiding its siblings", () => {
  const port = initial.nodes.find(n => n.title === "clk_r_i")!;
  const traced = revealTrace(design, session, port.key, "forward");
  const wires = buildVisibleConnectivity(design, traced).edges.filter(e => e.netName === "clk_r_i");
  expect(wires.length).toBeGreaterThan(1);
  const collapsed = collapseWire(traced, wires[0].key);
  expect(collapsed.revealedEdges!.has(wires[0].key)).toBe(false);
  const after = buildVisibleConnectivity(design, { ...collapsed, fanoutLimit: 0 });
  expect(after.edges.some(e => e.key === wires[0].key)).toBe(false);
  for (const wire of wires.slice(1)) expect(after.edges.some(e => e.key === wire.key)).toBe(true);
});

it("collapses internal wires independently and restores them on explicit logic expansion", () => {
  const expanded = expandComponent(design, session, process.key, true);
  const graph = buildVisibleConnectivity(design, expanded);
  const parent = graph.nodes.find(n => n.key === process.key)!;
  const clock = parent.pins.find(p => p.name === "clk_r_i")!;
  const wire = parent.interiorEdges!.find(e => e.sourcePin === clock.id)!;
  const outer = graph.edges.find(e => e.targetPin === input.id)!;
  const collapsed = collapseWire(collapseWire(expanded, wire.key), outer.key);
  const after = buildVisibleConnectivity(design, collapsed);
  expect(after.nodes.find(n => n.key === process.key)!.pins.find(p => p.id === clock.id)!.handles).toEqual({ inside: true, outside: true });
  expect(sceneEdges(after).some(e => e.key === wire.key)).toBe(false);
  for (const restored of [expandComponent(design, collapsed, process.key, true), expandHierarchy(design, collapsed, process.key, "logic")]) {
    const scene = buildVisibleConnectivity(design, restored);
    expect(sceneEdges(scene).some(e => e.key === wire.key)).toBe(true);
    expect(scene.edges.some(e => e.key === outer.key)).toBe(false);
  }
});
