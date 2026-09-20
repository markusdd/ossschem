import { readFileSync } from "node:fs";
import type { Design } from "@ossschem/ir";
import { expect, it } from "vitest";
import {
  buildLevel0Connectivity, buildVisibleConnectivity, defaultSession, expandComponent,
  revealTrace, sessionKey,
} from "../src/index.js";

const design = JSON.parse(readFileSync(new URL("../../../fixtures/svb_afifo/golden/schematic-ir.json", import.meta.url), "utf8")) as Design;

function expandedInstance() {
  let session = defaultSession(design);
  const array = buildLevel0Connectivity(design).nodes.find(n => n.kind === "instanceArray")!;
  session = expandComponent(design, session, array.key, true);
  const instance = buildLevel0Connectivity(design, undefined, session).nodes.find(n => n.kind === "instance")!;
  session = expandComponent(design, session, instance.key, true);
  return { session, key: instance.key };
}

it("expands internal instance clocks and resets without revealing their outer nets", () => {
  const { session, key } = expandedInstance();
  // Check both the normal connectivity API and the filtered scene used by the UI.
  for (const graph of [buildLevel0Connectivity(design, undefined, session), buildVisibleConnectivity(design, session)]) {
    const instance = graph.nodes.find(n => n.key === key)!;
    for (const name of ["clk_i", "rst_an_i"]) {
      const pin = instance.pins.find(p => p.name === name)!;
      const wires = instance.interiorEdges!.filter(e => e.sourcePin === pin.id);
      expect(wires).toHaveLength(1);
      expect(wires[0].stubbed).toBe(false);
      expect(graph.edges.some(e => e.targetPin === pin.id)).toBe(false);
      const childPin = instance.children!.flatMap(n => n.pins).find(p => p.id === wires[0].targetPin)!;
      expect(childPin.collapsed).toBe(false);
    }
  }
  const instance = buildVisibleConnectivity(design, session).nodes.find(n => n.key === key)!;
  for (const name of ["clk_i", "rst_an_i"]) {
    expect(instance.pins.find(p => p.name === name)!.handles).toEqual({ inside: false, outside: true });
  }
});

it("applies the fanout threshold locally inside an instance, including its exact boundary", () => {
  const { session, key } = expandedInstance();
  for (const [limit, shown] of [[1, false], [2, true], [0, true]] as const) {
    const graph = buildVisibleConnectivity(design, { ...session, fanoutLimit: limit });
    const instance = graph.nodes.find(n => n.key === key)!;
    for (const name of ["clk_i", "rst_an_i", "d_i"]) {
      const pin = instance.pins.find(p => p.name === name)!;
      expect(instance.interiorEdges!.some(e => e.sourcePin === pin.id)).toBe(shown);
      expect(pin.handles?.inside).toBe(!shown);
    }
  }
});

it("changes default datapath visibility while retaining explicitly traced wires", () => {
  const session = { ...defaultSession(design), fanoutLimit: 1 };
  const hidden = buildVisibleConnectivity(design, session);
  const process = hidden.nodes.find(n => n.title === "proc_r_pointer")!;
  const input = process.pins.find(p => p.name === "ren_i")!;
  expect(hidden.edges.some(e => e.targetPin === input.id)).toBe(false);
  const unlimited = buildVisibleConnectivity(design, { ...session, fanoutLimit: 0 });
  expect(unlimited.edges.some(e => e.targetPin === input.id)).toBe(true);
  const traced = revealTrace(design, session, input.id, "back", "outside");
  for (const limit of [0, 8, 1]) {
    const graph = buildVisibleConnectivity(design, { ...traced, fanoutLimit: limit });
    expect(graph.edges.some(e => e.targetPin === input.id)).toBe(true);
  }
});

it("includes fanout preferences in session identity", () => {
  const session = defaultSession(design);
  expect(sessionKey(session)).toBe(sessionKey({ ...session, fanoutLimit: 8 }));
  expect(sessionKey(session)).not.toBe(sessionKey({ ...session, fanoutLimit: 0 }));
});
