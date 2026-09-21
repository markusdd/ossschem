import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Design } from "@ossschem/ir";
import { buildLevel0Connectivity, defaultSession, probeTargets, resolveProbePath, sceneEdges, selectionInfo } from "../src/index.js";

const design = JSON.parse(
  readFileSync(new URL("../../../fixtures/svb_afifo/golden/schematic-ir.json", import.meta.url), "utf8"),
) as Design;
const session = defaultSession(design);
const graph = buildLevel0Connectivity(design);

describe("probe target", () => {
  it("names a signal the way a waveform dump does: scope path, then the signal", () => {
    const wire = sceneEdges(graph).find((e) => e.netName !== undefined)!;
    const paths = probeTargets(design, session, wire.key);
    expect(paths).toHaveLength(1);
    expect(paths[0][0]).toBe(design.modules[design.top].name);
    expect(paths[0][paths[0].length - 1]).toBe(
      design.modules[design.top].nets.find((n) => n.id === wire.netId?.split("#net:")[1])?.name,
    );
  });

  it("reports nothing for a selection that is not a signal", () => {
    const box = graph.nodes.find((n) => n.kind === "always")!;
    expect(probeTargets(design, session, box.key)).toEqual([]);
    expect(probeTargets(design, session, null)).toEqual([]);
  });

  it("qualifies a signal inside an instance with the instance path", () => {
    const top = design.modules[design.top];
    const instance = top.instances.find((i) => i.kind === "instance")!;
    const inner = { ...session, moduleId: instance.module, path: [top.name, ...instance.relPath] };
    const innerGraph = buildLevel0Connectivity(design, undefined, inner);
    const wire = sceneEdges(innerGraph).find((e) => e.netName !== undefined)!;
    const paths = probeTargets(design, inner, wire.key);
    expect(paths).toHaveLength(1);
    // the dump nests the instance under the top, and so must the probe
    expect(paths[0].slice(0, 1 + instance.relPath.length)).toEqual([top.name, ...instance.relPath]);
  });
});

/* A testbench drives its DUTs from arrays -- one element per instance -- and
 * the signals have no driver inside the module, so they are drawn as open
 * ends. Both shapes have to be probeable. */
const span = { file: "/tb.sv", fileId: "a", startLine: 1, startCol: 1, endLine: 1, endCol: 2 };
const bit = { msb: 0, lsb: 0, packed: true };

function benchDesign(): Design {
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
            drivers: [], loads: [{ kind: "box", box: "i0", pin: "clk_i" }] },
          { id: "n1", name: "data_s", width: bit, kind: "memory", memory: { depth: 2, packed: bit }, span,
            drivers: [], loads: [{ kind: "box", box: "i0", pin: "d_i" }] },
        ],
        instances: [{
          kind: "instance", id: "i0", name: "u_dut", module: "m1", relPath: ["u_dut"], span,
          pins: [
            { port: "clk_i", net: "n0", span },
            { port: "d_i", net: "n1", element: 0, span },
          ],
        }],
      },
      m1: {
        id: "m1", name: "dut", origName: "dut", span, params: [], boxes: [], instances: [],
        ports: [
          { id: "p0", name: "clk_i", dir: "input", net: "n2", span },
          { id: "p1", name: "d_i", dir: "input", net: "n3", span },
        ],
        nets: [
          { id: "n2", name: "clk_i", width: bit, kind: "port", span, drivers: [], loads: [] },
          { id: "n3", name: "d_i", width: bit, kind: "port", span, drivers: [], loads: [] },
        ],
      },
    },
  };
}

describe("probing a testbench", () => {
  const bench = benchDesign();
  const benchSession = defaultSession(bench);
  const benchGraph = buildLevel0Connectivity(bench, undefined, benchSession);

  it("probes a signal drawn as an open end, not just a declared port", () => {
    const open = benchGraph.nodes.find((n) => n.kind === "open" && n.title === "clk_s");
    expect(open).toBeDefined();
    expect(probeTargets(bench, benchSession, open!.key)).toEqual([["tb", "clk_s"]]);
  });

  it("names an array element by index alone, inside the array scope", () => {
    const wire = sceneEdges(benchGraph).find((e) => e.netId?.endsWith("#net:n1"));
    expect(wire).toBeDefined();
    // a dump nests an unpacked array in a scope of its own, and the element
    // is named by index because the scope already carries the name
    expect(probeTargets(bench, benchSession, wire!.key)).toEqual([["tb", "data_s", "[0]"]]);
  });

  it("reports drivers and loads for an open end, as it does for a port", () => {
    const open = benchGraph.nodes.find((n) => n.kind === "open" && n.title === "clk_s")!;
    const info = selectionInfo(bench, benchSession, open.key);
    expect(info?.signal).toBeDefined();
    expect(info?.signal?.loads.length).toBeGreaterThan(0);
  });

  it("expands an array into its elements, since the scope alone is not plottable", () => {
    const open = benchGraph.nodes.find((n) => n.kind === "open" && n.title === "data_s");
    expect(open).toBeDefined();
    expect(probeTargets(bench, benchSession, open!.key)).toEqual([
      ["tb", "data_s", "[0]"],
      ["tb", "data_s", "[1]"],
    ]);
  });

  it("names elements by the declared range, not by counting from zero", () => {
    const shifted = benchDesign();
    const net = shifted.modules.m0.nets.find((n) => n.id === "n1")!;
    net.memory = { depth: 2, packed: bit, range: { msb: 4, lsb: 3 } };
    const shiftedSession = defaultSession(shifted);
    const graph = buildLevel0Connectivity(shifted, undefined, shiftedSession);
    const open = graph.nodes.find((n) => n.kind === "open" && n.title === "data_s")!;
    expect(probeTargets(shifted, shiftedSession, open.key)).toEqual([
      ["tb", "data_s", "[3]"],
      ["tb", "data_s", "[4]"],
    ]);
  });
});

describe("resolving a name from the waveform viewer", () => {
  const bench = benchDesign();

  it("finds a signal at the top", () => {
    expect(resolveProbePath(bench, ["tb", "clk_s"])).toMatchObject({ moduleId: "m0", path: ["tb"], netName: "clk_s" });
  });

  it("walks into an instance", () => {
    expect(resolveProbePath(bench, ["tb", "u_dut", "clk_i"])).toMatchObject({
      moduleId: "m1", path: ["tb", "u_dut"], netName: "clk_i",
    });
  });

  it("takes an array element back to its array", () => {
    expect(resolveProbePath(bench, ["tb", "data_s", "[1]"])).toMatchObject({ path: ["tb"], netName: "data_s" });
  });

  it("round-trips whatever probeTargets produced", () => {
    const session = defaultSession(bench);
    const graph = buildLevel0Connectivity(bench, undefined, session);
    const open = graph.nodes.find((n) => n.kind === "open" && n.title === "data_s")!;
    for (const path of probeTargets(bench, session, open.key)) {
      expect(resolveProbePath(bench, path)?.netName).toBe("data_s");
    }
  });

  it("refuses a name from somewhere else", () => {
    expect(resolveProbePath(bench, ["other_tb", "clk_s"])).toBeNull();
    expect(resolveProbePath(bench, ["tb", "nope"])).toBeNull();
    expect(resolveProbePath(bench, ["tb"])).toBeNull();
  });
});
