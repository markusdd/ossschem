import { describe, expect, it } from "vitest";
import type { Design } from "@ossschem/ir";
import { buildLevel0Connectivity, defaultSession, hopAtBoundary, pinLabel, sceneEdges } from "../src/index.js";

/* A testbench drives two DUTs from one unpacked array and collects their
 * outputs into another: a fan-out and a fan-in of the same shape. */
const span = { file: "/tb.sv", fileId: "a", startLine: 1, startCol: 1, endLine: 1, endCol: 2 };
const byte = { msb: 7, lsb: 0, packed: true };
const bit = { msb: 0, lsb: 0, packed: true };

function bench(): Design {
  const member = (id: string, index: number) => ({
    kind: "instance" as const, id, name: "u_dut", module: "m1", relPath: [`dut_gen[${index}]`, "u_dut"], span,
    pins: [
      { port: "clk_i", net: "n0", span },
      { port: "d_i", net: "n1", element: index, span },
      { port: "q_o", net: "n2", element: index, span },
    ],
  });
  return {
    schemaVersion: 1,
    top: "m0",
    files: {},
    meta: { producer: "verilator-json-only", verilatorVersion: "5.050", dumpedAt: "" },
    modules: {
      m0: {
        id: "m0", name: "tb", origName: "tb", span, params: [], ports: [], boxes: [],
        nets: [
          { id: "n0", name: "clk_s", width: bit, kind: "wire", span,
            drivers: [], loads: ["i0", "i1"].map((box) => ({ kind: "box" as const, box, pin: "clk_i" })) },
          { id: "n1", name: "data_s", width: byte, kind: "memory", memory: { depth: 2, packed: byte }, span,
            drivers: [], loads: ["i0", "i1"].map((box) => ({ kind: "box" as const, box, pin: "d_i" })) },
          { id: "n2", name: "q_s", width: byte, kind: "memory", memory: { depth: 2, packed: byte }, span,
            drivers: ["i0", "i1"].map((box) => ({ kind: "box" as const, box, pin: "q_o" })), loads: [] },
        ],
        instances: [member("i0", 0), member("i1", 1)],
      },
      m1: {
        id: "m1", name: "dut", origName: "dut", span, params: [], boxes: [], instances: [],
        ports: [
          { id: "p0", name: "clk_i", dir: "input", net: "n3", span },
          { id: "p1", name: "d_i", dir: "input", net: "n4", span },
          { id: "p2", name: "q_o", dir: "output", net: "n5", span },
        ],
        nets: [
          { id: "n3", name: "clk_i", width: bit, kind: "port", span, drivers: [], loads: [] },
          { id: "n4", name: "d_i", width: byte, kind: "port", span, drivers: [], loads: [] },
          { id: "n5", name: "q_o", width: byte, kind: "port", span, drivers: [], loads: [] },
        ],
      },
    },
  } as Design;
}

const design = bench();
const session = defaultSession(design);
const graph = buildLevel0Connectivity(design, undefined, session, true);
const splits = graph.nodes.filter((n) => n.kind === "split");

describe("splitting an unpacked array", () => {
  it("draws one splitter per array, facing the way the elements go", () => {
    expect(splits.map((n) => `${n.title} ${n.badge}`)).toEqual(["data_s fanout", "q_s fanin"]);
    // a plain wire fans out without one: its loads all carry the same signal
    expect(splits.some((n) => n.title === "clk_s")).toBe(false);
  });

  it("carries the array on the trunk and one element on each branch", () => {
    const [fanOut] = splits;
    const trunk = fanOut.pins.filter((p) => p.element === undefined);
    expect(trunk).toHaveLength(1);
    expect(trunk[0].side).toBe("W");
    expect(fanOut.pins.filter((p) => p.side === "E").map((p) => p.name)).toEqual(["[0]", "[1]"]);
  });

  it("states the count and the element width on the trunk, the element on each branch", () => {
    const edges = sceneEdges(graph).filter((e) => e.netId?.endsWith("#net:n1"));
    const trunk = edges.find((e) => e.element === undefined)!;
    expect(trunk.widthText).toBe("2×8b");
    expect(edges.filter((e) => e.element !== undefined).map((e) => [e.element, e.width, e.netName]))
      .toEqual([[0, 8, "data_s[0]"], [1, 8, "data_s[1]"]]);
  });

  it("says on the array's own box that it is an array, not one wide signal", () => {
    const box = graph.nodes.find((n) => n.kind === "open" && n.title === "data_s")!;
    expect(pinLabel(box.pins[0])).toBe("data_s · 2×8b");
  });

  it("is a waypoint, not a component: a trace crosses it to the members", () => {
    const box = graph.nodes.find((n) => n.kind === "open" && n.title === "data_s")!;
    const reached = new Set(hopAtBoundary(design, box.key, "forward", session));
    for (const member of graph.nodes.filter((n) => n.kind === "instance")) {
      expect(reached.has(member.key)).toBe(true);
    }
  });
});
