import { buildLevel0Connectivity, defaultSession, sceneEdges } from "@ossschem/graph";
import type { Design } from "@ossschem/ir";
import { describe, expect, it } from "vitest";
import { layoutLevel0 } from "../src/index.js";

/* A mux takes its select from the top, so the data inputs on its left are
 * only the values it chooses between. */
const span = { file: "/m.sv", fileId: "a", startLine: 1, startCol: 1, endLine: 1, endCol: 2 };
const bit = { msb: 0, lsb: 0, packed: true };

const design = {
  schemaVersion: 1,
  top: "m0",
  files: {},
  meta: { producer: "verilator-json-only", verilatorVersion: "5.046", dumpedAt: "" },
  modules: {
    m0: {
      id: "m0", name: "m", origName: "m", span, params: [], instances: [],
      ports: [
        { id: "p0", name: "sel_i", dir: "input", net: "n0", span },
        { id: "p1", name: "a_i", dir: "input", net: "n2", span },
        { id: "p2", name: "b_i", dir: "input", net: "n3", span },
        { id: "p3", name: "q_o", dir: "output", net: "n1", span },
      ],
      nets: [
        { id: "n0", name: "sel_i", width: bit, kind: "port", span, drivers: [], loads: [{ kind: "box", box: "b0", pin: "sel_i" }] },
        { id: "n2", name: "a_i", width: bit, kind: "port", span, drivers: [], loads: [{ kind: "box", box: "b0", pin: "a_i" }] },
        { id: "n3", name: "b_i", width: bit, kind: "port", span, drivers: [], loads: [{ kind: "box", box: "b0", pin: "b_i" }] },
        { id: "n1", name: "q_o", width: bit, kind: "port", span, drivers: [{ kind: "box", box: "b0", pin: "q_o" }], loads: [] },
      ],
      boxes: [{
        kind: "assign", id: "b0", name: "assign q_o", span,
        ports: [
          { name: "sel_i", dir: "in", net: "n0" }, { name: "a_i", dir: "in", net: "n2" },
          { name: "b_i", dir: "in", net: "n3" }, { name: "q_o", dir: "out", net: "n1" },
        ],
        contents: {
          nets: [],
          cells: [{ id: "c0", kind: "mux", pins: { S: { net: "n0" }, B: { net: "n3" }, A: { net: "n2" }, Y: { net: "n1" } }, span }],
        },
      }],
    },
  },
} as Design;

describe("a mux select", () => {
  it("enters through the top edge, above both data inputs", async () => {
    const session = defaultSession(design);
    const box = buildLevel0Connectivity(design).nodes.find((n) => n.kind === "assign")!;
    session.expansion.add(box.key);
    const conn = buildLevel0Connectivity(design, undefined, session);
    const laid = await layoutLevel0(conn.nodes, conn.edges, { timeoutMs: 10_000 });
    const outer = laid.nodes.find((n) => n.kind === "assign")!;
    const mux = outer.children!.find((n) => n.symbol === "mux")!;
    const pin = (name: string) => mux.pins.find((p) => p.name === name)!;
    expect(pin("S").face).toBe("N");
    expect(pin("S").side).toBe("W");
    expect(pin("S").y!).toBeLessThan(pin("A").y!);
    expect(pin("A").y!).toBeLessThan(pin("B").y!);

    const selectWire = sceneEdges(conn).find((e) => e.targetPin === pin("S").id)!;
    const route = laid.edges.find((e) => e.key === selectWire.key)!;
    const end = route.points[route.points.length - 1];
    const before = route.points[route.points.length - 2];
    expect(Math.abs(end.x - (outer.x + mux.x + pin("S").x!))).toBeLessThan(1);
    expect(Math.abs(end.y - (outer.y + mux.y + pin("S").y!))).toBeLessThan(1);
    // the last leg comes down onto the pin
    expect(Math.abs(before.x - end.x)).toBeLessThan(1);
    expect(before.y).toBeLessThan(end.y);
  });
});
