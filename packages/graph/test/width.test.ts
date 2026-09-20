import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Design } from "@ossschem/ir";
import { buildLevel0Connectivity, defaultSession, flattenNodes, sceneEdges } from "../src/index.js";
import { combinedWidth, referenceWidth } from "../src/width.js";

const design = JSON.parse(readFileSync(new URL("../../../fixtures/svb_afifo/golden/schematic-ir.json", import.meta.url), "utf8")) as Design;

it("carries 32-bit data and scalar control widths into the graph", () => {
  const graph = buildLevel0Connectivity(design);
  expect(graph.nodes.find(n => n.title === "wdata_i")!.pins[0].width).toBe(32);
  expect(graph.nodes.find(n => n.title === "ren_i")!.pins[0].width).toBe(1);
  expect(graph.edges.filter(e => e.netName === "wdata_i").every(e => e.width === 32)).toBe(true);
  expect(graph.edges.find(e => e.netName === "full_s")!.width).toBe(1);
});

it("labels an aggregated 5-bit array as a bus and its individual bit connections as scalar", () => {
  const session = defaultSession(design);
  const graph = buildLevel0Connectivity(design);
  const array = graph.nodes.find(n => n.kind === "instanceArray")!;
  expect(array.pins.find(p => p.name === "d_i")!.width).toBe(5);
  expect(graph.edges.find(e => e.targetKey === array.key && e.targetPin.endsWith("::d_i"))!.width).toBe(5);
  session.exploded.add(array.key);
  let exploded = buildLevel0Connectivity(design, undefined, session);
  const member = exploded.nodes.find(n => n.kind === "instance")!;
  expect(member.pins.find(p => p.name === "d_i")!.width).toBe(1);
  expect(exploded.edges.find(e => e.targetKey === member.key && e.targetPin.endsWith("::d_i"))!.width).toBe(1);
  session.expansion.add(member.key);
  exploded = buildLevel0Connectivity(design, undefined, session);
  expect(exploded.nodes.find(n => n.key === member.key)!.interiorEdges!.every(e => e.width === 1)).toBe(true);
});

it("preserves bus and temporary scalar widths inside expanded logic", () => {
  const session = defaultSession(design);
  const process = buildLevel0Connectivity(design).nodes.find(n => n.title === "proc_r_pointer")!;
  session.expansion.add(process.key);
  const graph = buildLevel0Connectivity(design, undefined, session);
  const gates = flattenNodes(graph.nodes).filter(n => n.kind === "primitive");
  expect(gates.find(n => n.symbol === "and")!.pins.every(p => p.width === 1)).toBe(true);
  expect(gates.find(n => n.title === "bin_rpointer_r")!.pins.find(p => p.name === "D")!.width).toBe(5);
  const edges = sceneEdges(graph);
  const internal = graph.nodes.find(n => n.key === process.key)!.interiorEdges!;
  expect(internal.find(e => e.netName === "bin_rpointer_r")!.width).toBe(5);
  const memoryRead = graph.nodes.find(n => n.title === "proc_fifo_mem_r")!;
  expect(edges.find(e => e.netName === "bin_rpointer_r" && e.targetKey === memoryRead.key)!.width).toBe(4);
  expect(edges.every(e => e.width !== undefined)).toBe(true);
});

it("counts ascending and overlapping ranges without guessing widths for missing nets", () => {
  expect(referenceWidth({ net: "bus", bits: { msb: 4, lsb: 11 } }, [])).toBe(8);
  expect(referenceWidth({ net: "unknown" }, [])).toBeUndefined();
  expect(combinedWidth([
    { net: "bus", bits: { msb: 7, lsb: 4 } },
    { net: "bus", bits: { msb: 5, lsb: 2 } },
  ], [])).toBe(6);
});
