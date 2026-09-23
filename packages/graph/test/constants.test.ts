import { describe, expect, it } from "vitest";
import type { Design } from "@ossschem/ir";
import { buildLevel0Connectivity, defaultSession, flattenNodes, sceneEdges } from "../src/index.js";

/* A constant that something reads is part of the drawing: the branches of a
 * state machine are constants, and a mux with nothing on its inputs is a mux
 * that says nothing. */
const span = { file: "/m.sv", fileId: "a", startLine: 1, startCol: 1, endLine: 1, endCol: 2 };
const byte = { msb: 7, lsb: 0, packed: true };

const design: Design = {
  schemaVersion: 1,
  top: "m0",
  files: {},
  meta: { producer: "verilator-json-only", verilatorVersion: "5.046", dumpedAt: "" },
  modules: {
    m0: {
      id: "m0", name: "m", origName: "m", span, params: [], instances: [],
      ports: [
        { id: "p0", name: "sel_i", dir: "input", net: "n0", span },
        { id: "p1", name: "q_o", dir: "output", net: "n1", span },
      ],
      nets: [
        { id: "n0", name: "sel_i", width: { msb: 0, lsb: 0, packed: true }, kind: "port", span, drivers: [], loads: [{ kind: "box", box: "b0", pin: "sel_i" }] },
        { id: "n1", name: "q_o", width: byte, kind: "port", span, drivers: [{ kind: "box", box: "b0", pin: "q_o" }], loads: [] },
      ],
      boxes: [{
        kind: "assign", id: "b0", name: "assign q_o", span,
        ports: [{ name: "sel_i", dir: "in", net: "n0" }, { name: "q_o", dir: "out", net: "n1" }],
        contents: {
          nets: [
            { id: "t0", name: "t0", width: byte, kind: "wire", span, drivers: [], loads: [] },
            { id: "t1", name: "t1", width: byte, kind: "wire", span, drivers: [], loads: [] },
          ],
          cells: [
            { id: "c0", kind: "const", params: { value: "8'h0f" }, pins: { Y: { net: "t0" } }, span },
            { id: "c1", kind: "const", params: { value: "8'ha3" }, pins: { Y: { net: "t1" } }, span },
            { id: "c2", kind: "mux", pins: { S: { net: "n0" }, B: { net: "t0" }, A: { net: "t1" }, Y: { net: "n1" } }, span },
          ],
        },
      }],
    },
  },
} as Design;

describe("a constant read by a cell", () => {
  const session = defaultSession(design);
  const box = buildLevel0Connectivity(design).nodes.find((n) => n.kind === "assign")!;
  session.expansion.add(box.key);
  const graph = buildLevel0Connectivity(design, undefined, session);
  const consts = flattenNodes(graph.nodes).filter((n) => n.symbol === "const");

  it("is drawn, and is called by its value", () => {
    expect(consts.map((n) => n.title).sort()).toEqual(["8'h0f", "8'ha3"]);
  });

  it("reaches what reads it, so the mux data inputs are connected", () => {
    const mux = flattenNodes(graph.nodes).find((n) => n.symbol === "mux")!;
    const sources = new Set(sceneEdges(graph).filter((e) => e.targetKey === mux.key).map((e) => e.sourceKey));
    for (const value of consts) {
      expect(sources.has(value.key)).toBe(true);
    }
    // and the select still comes in from the box boundary
    expect(sources.size).toBe(3);
  });
});
