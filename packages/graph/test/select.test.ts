import { readFileSync } from "node:fs";
import type { Design } from "@ossschem/ir";
import { expect, it } from "vitest";
import {
  buildHierarchy, buildLevel0Connectivity, buildVisibleConnectivity, defaultSession, expandComponent,
  expandHierarchy, flattenNodes, isolateComponent, moduleRootKey, revealSignalConnection, revealTrace,
  sceneEdges, selectionInfo,
} from "../src/index.js";

const design = JSON.parse(readFileSync(new URL("../../../fixtures/svb_afifo/golden/schematic-ir.json", import.meta.url), "utf8")) as Design;

it("shows the same declaration for a port, its pin, and its wire", () => {
  const session = defaultSession(design);
  const graph = buildLevel0Connectivity(design);
  const port = graph.nodes.find(n => n.title === "ren_i")!;
  const wire = graph.edges.find(e => e.sourceKey === port.key)!;
  const net = design.modules[design.top].nets.find(n => n.name === "ren_i")!;
  for (const key of [port.key, port.pins[0].id, wire.key, wire.targetPin]) {
    const info = selectionInfo(design, session, key)!;
    expect(info.sourceKind).toBe("declaration");
    expect(info.span).toEqual(net.span);
    expect(info.title).toBe("ren_i");
    expect(info.signal!.drivers.map(p => p.nodeKey)).toEqual([port.key]);
    expect(info.signal!.loads.some(p => p.pinKey === wire.targetPin)).toBe(true);
  }
});

it("shows expression source for temporary wires and module source for the hierarchy root", () => {
  let session = defaultSession(design);
  const process = buildLevel0Connectivity(design).nodes.find(n => n.title === "proc_r_pointer")!;
  session = expandComponent(design, session, process.key, true);
  const graph = buildLevel0Connectivity(design, undefined, session);
  const wire = graph.nodes.find(n => n.key === process.key)!.interiorEdges!.find(e => e.netId.includes("#net:t"))!;
  const info = selectionInfo(design, session, wire.key)!;
  expect(info.sourceKind).toBe("expression");
  expect(info.span?.startLine).toBeGreaterThan(0);
  expect(info.expr).toBeTruthy();
  expect(info.signal!.drivers.length).toBeGreaterThan(0);
  expect(info.signal!.loads.length).toBeGreaterThan(0);
  expect(selectionInfo(design, session, moduleRootKey(session))!.span).toEqual(design.modules[design.top].span);
});

it("resolves occurrence-local declarations and omits pass-through boundaries from endpoint lists", () => {
  let session = defaultSession(design);
  const array = buildHierarchy(design, session).find(n => n.kind === "instanceArray")!;
  const instance = array.children[0];
  session = expandHierarchy(design, session, instance.key, "structure");
  const graph = buildLevel0Connectivity(design, undefined, session, true);
  const node = graph.nodes.find(n => n.key === instance.key)!;
  const internal = node.interiorEdges!.find(e => e.netName === "d1_r")!;
  const info = selectionInfo(design, session, internal.key)!;
  const childModule = Object.values(design.modules).find(m => m.name === "svb_sync")!;
  expect(info.span).toEqual(childModule.nets.find(n => n.name === "d1_r")!.span);
  expect(info.fileBasename).toBe("svb_sync.sv");
  const clock = node.pins.find(p => p.name === "clk_i")!;
  const clockInfo = selectionInfo(design, session, clock.id)!;
  expect(clockInfo.signal!.loads.some(e => e.nodeKey === node.key)).toBe(false);
  expect(clockInfo.signal!.loads.some(e => e.nodeKey === node.children!.find(n => n.kind === "always")!.key)).toBe(true);
  expect(clockInfo.signal!.drivers.every(e => graph.nodes.find(n => n.key === e.nodeKey)?.kind === "port")).toBe(true);
});

it("reveals only the chosen load from an isolated hidden-fanout signal", () => {
  let session = { ...defaultSession(design), fanoutLimit: 1 };
  const graph = buildLevel0Connectivity(design, undefined, session, true);
  const port = graph.nodes.find(n => n.title === "ren_i")!;
  session = { ...isolateComponent(design, session, port.key), fanoutLimit: 1 };
  const info = selectionInfo(design, session, port.key)!;
  expect(info.signal!.loads.length).toBeGreaterThan(1);
  const target = info.signal!.loads[0];
  const revealed = revealSignalConnection(design, session, port.key, target.pinKey);
  const shown = buildVisibleConnectivity(design, revealed);
  expect(new Set(shown.nodes.map(n => n.key))).toEqual(new Set([port.key, target.nodeKey]));
  expect(shown.edges).toHaveLength(1);
  expect(shown.edges[0].targetPin).toBe(target.pinKey);
  expect(buildVisibleConnectivity(design, session).nodes).toHaveLength(1);
});

it("reveals a selected hidden driver across an instance boundary in an isolated view", () => {
  let session = defaultSession(design);
  const array = buildHierarchy(design, session).find(n => n.kind === "instanceArray")!;
  session = expandHierarchy(design, session, array.children[0].key, "logic");
  const graph = buildLevel0Connectivity(design, undefined, session, true);
  const gate = flattenNodes(graph.nodes).find(n => n.kind === "primitive" && n.id.path.some(p => p.includes("u_svb_sync")))!;
  const clock = gate.pins.find(p => p.name === "CLK")!;
  session = isolateComponent(design, session, gate.key);
  const driver = selectionInfo(design, session, clock.id)!.signal!.drivers[0];
  const revealed = revealSignalConnection(design, session, clock.id, driver.pinKey);
  const shown = buildVisibleConnectivity(design, revealed);
  expect(shown.nodes.some(n => n.key === driver.nodeKey)).toBe(true);
  expect(sceneEdges(shown).some(e => e.targetPin === clock.id)).toBe(true);
  expect(sceneEdges(shown).some(e => e.sourcePin === driver.pinKey)).toBe(true);
  expect(flattenNodes(shown.nodes).filter(n => n.kind === "primitive").map(n => n.key)).toEqual([gate.key]);
});

it("reveals endpoints hidden by partial process tracing without opening unrelated logic", () => {
  let session = defaultSession(design);
  const process = buildLevel0Connectivity(design).nodes.find(n => n.title === "proc_r_pointer")!;
  const input = process.pins.find(p => p.name === "ren_i")!;
  session = revealTrace(design, session, input.id, "forward", "inside");
  const clock = process.pins.find(p => p.name === "clk_r_i")!;
  const target = selectionInfo(design, session, clock.id)!.signal!.loads.find(e => e.pinKey.endsWith("::CLK") && e.pinKey.includes("proc_r_pointer"))!;
  const revealed = revealSignalConnection(design, session, clock.id, target.pinKey);
  const shown = buildVisibleConnectivity(design, revealed);
  expect(flattenNodes(shown.nodes).some(n => n.key === target.nodeKey)).toBe(true);
  expect(sceneEdges(shown).some(e => e.targetPin === target.pinKey)).toBe(true);
  expect(revealed.partial!.get(process.key)!.size).toBeLessThan(buildLevel0Connectivity(design, undefined, revealed).nodes.find(n => n.key === process.key)!.children!.length);
});
