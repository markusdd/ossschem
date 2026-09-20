import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Design } from "@ossschem/ir";
import { advanceTrace, buildLevel0Connectivity, buildVisibleConnectivity, defaultSession, expandComponent,
  flattenNodes, isolateComponent, sceneEdges } from "../src/index.js";

const design = JSON.parse(readFileSync(new URL("../../../fixtures/svb_afifo/golden/schematic-ir.json", import.meta.url), "utf8")) as Design;
const session = defaultSession(design);
const initial = buildLevel0Connectivity(design);
const process = initial.nodes.find(n => n.title === "proc_r_pointer")!;
const input = process.pins.find(p => p.name === "ren_i")!;
const output = process.pins.find(p => p.name === "bin_rpointer_r")!;

it("advances from a process input through its enable gate, register and output on successive presses", () => {
  const isolated = isolateComponent(design, session, process.key);
  const first = advanceTrace(design, isolated, input.id, "forward");
  const firstNodes = flattenNodes(buildVisibleConnectivity(design, first).nodes);
  expect(first.trace!.frontier.length).toBeGreaterThan(0);
  expect(firstNodes.some(n => n.symbol === "and")).toBe(true);
  expect(firstNodes.some(n => n.symbol?.includes("dff"))).toBe(false);
  const second = advanceTrace(design, first, input.id, "forward");
  const secondNodes = flattenNodes(buildVisibleConnectivity(design, second).nodes);
  expect(secondNodes.some(n => n.symbol?.includes("dff"))).toBe(true);
  expect(second.trace!.origin).toBe(input.id);
  expect(second.trace!.step).toBe(2);
  const third = advanceTrace(design, second, input.id, "forward");
  expect(third.trace!.keys.has(output.id)).toBe(true);
  expect(third.trace!.keys.size).toBeGreaterThan(second.trace!.keys.size);
  for (const key of second.trace!.keys) expect(third.trace!.keys.has(key)).toBe(true);
  expect(first.trace!.step).toBe(1);
  expect(isolated.expansion.has(process.key)).toBe(false);
});

it("backward tracing through a register follows D and EN, without clock or reset", () => {
  const first = advanceTrace(design, isolateComponent(design, session, process.key), output.id, "back");
  const register = flattenNodes(buildVisibleConnectivity(design, first).nodes).find(n => n.symbol?.includes("dff"))!;
  expect(register).toBeDefined();
  const second = advanceTrace(design, first, output.id, "back");
  for (const name of ["D", "EN"]) {
    const pin = register.pins.find(p => p.name === name)!;
    expect(pin).toBeDefined();
    expect(second.trace!.keys.has(pin.id)).toBe(true);
  }
  for (const name of ["CLK", "ARST"]) {
    const pin = register.pins.find(p => p.name === name)!;
    expect(second.trace!.keys.has(pin.id)).toBe(false);
    expect(second.trace!.focus).not.toContain(pin.id);
  }
  const clock = process.pins.find(p => p.name === "clk_r_i")!;
  expect(sceneEdges(buildVisibleConnectivity(design, second)).filter(e => e.sourcePin === clock.id)
    .some(e => second.trace!.keys.has(e.key) || second.revealedEdges?.has(e.key))).toBe(false);
});

it("still permits deliberate backward tracing from a selected clock pin", () => {
  const expanded = expandComponent(design, session, process.key, true);
  const register = flattenNodes(buildLevel0Connectivity(design, undefined, expanded).nodes).find(n => n.symbol?.includes("dff"))!;
  const clock = register.pins.find(p => p.name === "CLK")!;
  const traced = advanceTrace(design, expanded, clock.id, "back");
  expect([...traced.trace!.keys].some(key => key.includes("clk_r_i"))).toBe(true);
});

it("advances all fanout branches and opens only reached internal paths", () => {
  const port = initial.nodes.find(n => n.title === "ren_i")!;
  const first = advanceTrace(design, isolateComponent(design, session, port.key), port.pins[0].id, "forward");
  expect(first.trace!.frontier.length).toBeGreaterThan(1);
  expect(first.expansion.size).toBe(0);
  const second = advanceTrace(design, first, port.pins[0].id, "forward");
  for (const pin of first.trace!.frontier) expect(second.trace!.visited.has(pin)).toBe(true);
  const partial = buildVisibleConnectivity(design, second).nodes.find(n => n.key === process.key)!;
  const full = buildLevel0Connectivity(design, undefined, second).nodes.find(n => n.key === process.key)!;
  expect(partial.children!.length).toBeLessThan(full.children!.length);
});

it("restarts from the origin when direction changes or a fresh trace is requested", () => {
  const first = advanceTrace(design, session, input.id, "forward");
  const second = advanceTrace(design, first, input.id, "forward");
  const reverse = advanceTrace(design, second, input.id, "back");
  expect(reverse.trace!.step).toBe(1);
  expect(reverse.trace!.direction).toBe("back");
  expect(reverse.trace!.keys.size).toBeLessThan(second.trace!.keys.size);
  expect(advanceTrace(design, second, input.id, "forward", { restart: true }).trace!.step).toBe(1);
});

it("terminates despite feedback through registers and does not repeat completed work", () => {
  let current = advanceTrace(design, session, output.id, "back");
  for (let i = 0; i < 150 && current.trace!.frontier.length; i++) {
    const before = current.trace!.visited.size;
    current = advanceTrace(design, current, output.id, "back");
    expect(current.trace!.visited.size).toBeGreaterThan(before);
  }
  expect(current.trace!.frontier).toEqual([]);
  expect(advanceTrace(design, current, output.id, "back")).toBe(current);
});

it("continues from a collapsed generate array into member instances and their processes", () => {
  const array = initial.nodes.find(n => n.kind === "instanceArray")!;
  const pin = array.pins.find(p => p.side === "E")!;
  let current = advanceTrace(design, isolateComponent(design, session, array.key), pin.id, "back");
  expect(current.exploded.has(array.key)).toBe(true);
  expect(current.trace!.frontier.length).toBeGreaterThan(1);
  current = advanceTrace(design, current, pin.id, "back");
  expect(flattenNodes(buildVisibleConnectivity(design, current).nodes).some(n => n.kind === "always")).toBe(true);
  // The synchronizer output may pass through an assign/slice before reaching its register.
  for (let i = 0; i < 8 && !flattenNodes(buildVisibleConnectivity(design, current).nodes).some(n => n.symbol?.includes("dff")); i++) {
    current = advanceTrace(design, current, pin.id, "back");
  }
  expect(flattenNodes(buildVisibleConnectivity(design, current).nodes).some(n => n.symbol?.includes("dff"))).toBe(true);
});
