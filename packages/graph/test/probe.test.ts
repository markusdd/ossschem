import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Design, Instance } from "@ossschem/ir";
import { buildLevel0Connectivity, defaultSession, type Level0Node, type ViewSession, netProbePath, probeTargets, resolveProbePath, revealPath, sceneEdges, selectionInfo } from "../src/index.js";

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
    const dut = benchGraph.nodes.find((n) => n.kind === "instance")!;
    const pin = dut.pins.find((p) => p.name === "d_i")!;
    // a dump nests an unpacked array in a scope of its own, and the element
    // is named by index because the scope already carries the name
    expect(probeTargets(bench, benchSession, pin.id)).toEqual([["tb", "data_s", "[0]"]]);
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

/* A generate loop drives one DUT per array element. Folded, the schematic
 * draws that connection once for the whole array; exploded, once per member. */
function arrayBenchDesign(): Design {
  const member = (id: string, index: number): Instance => ({
    kind: "instance", id, name: "u_dut", module: "m1", relPath: [`dut_gen[${index}]`, "u_dut"], span,
    pins: [{ port: "clk_i", net: "n0", span }, { port: "d_i", net: "n1", element: index, span }],
  });
  const design = benchDesign();
  const top = design.modules.m0;
  top.instances = [
    { kind: "instanceArray", id: "a0", name: "u_dut", module: "m1", generate: "dut_gen",
      range: { msb: 1, lsb: 0 }, members: ["i0", "i1"], span },
    member("i0", 0),
    member("i1", 1),
  ];
  for (const net of top.nets) {
    net.loads = ["i0", "i1"].map((box) => ({ kind: "box" as const, box, pin: net.name === "clk_s" ? "clk_i" : "d_i" }));
  }
  return design;
}

function explodedArrayBench(): { design: Design; sess: ViewSession; members: Level0Node[] } {
  const design = arrayBenchDesign();
  const sess = defaultSession(design);
  const array = buildLevel0Connectivity(design, undefined, sess).nodes.find((n) => n.kind === "instanceArray")!;
  sess.exploded.add(array.key);
  const members = buildLevel0Connectivity(design, undefined, sess).nodes.filter((n) => n.kind === "instance");
  expect(members).toHaveLength(2);
  return { design, sess, members };
}

describe("probing an array that feeds an instance array", () => {
  it("means every element when the connection is drawn once for the whole array", () => {
    const design = arrayBenchDesign();
    const sess = defaultSession(design);
    const graph = buildLevel0Connectivity(design, undefined, sess);
    const array = graph.nodes.find((n) => n.kind === "instanceArray")!;
    const wire = sceneEdges(graph).find((e) => e.targetKey === array.key && e.targetPin.endsWith("::d_i"))!;
    expect(probeTargets(design, sess, wire.key)).toEqual([
      ["tb", "data_s", "[0]"],
      ["tb", "data_s", "[1]"],
    ]);
  });

  it("names the element a branch off the splitter carries", () => {
    const { design, sess, members } = explodedArrayBench();
    for (const [index, node] of members.entries()) {
      // each member is reached by its own branch, so the wire names one element
      const wire = sceneEdges(buildLevel0Connectivity(design, undefined, sess))
        .find((e) => e.targetKey === node.key && e.targetPin.endsWith("::d_i"))!;
      expect(probeTargets(design, sess, wire.key)).toEqual([["tb", "data_s", `[${index}]`]]);
    }
  });

  it("means the whole array from the trunk and from the splitter itself", () => {
    const { design, sess } = explodedArrayBench();
    const graph = buildLevel0Connectivity(design, undefined, sess);
    const split = graph.nodes.find((n) => n.kind === "split")!;
    const trunk = sceneEdges(graph).find((e) => e.targetKey === split.key)!;
    const whole = [["tb", "data_s", "[0]"], ["tb", "data_s", "[1]"]];
    expect(probeTargets(design, sess, trunk.key)).toEqual(whole);
    expect(probeTargets(design, sess, split.key)).toEqual(whole);
  });

  it("names one element from the pin it is connected at", () => {
    const { design, sess, members } = explodedArrayBench();
    for (const [index, node] of members.entries()) {
      const pin = node.pins.find((p) => p.name === "d_i")!;
      expect(probeTargets(design, sess, pin.id)).toEqual([["tb", "data_s", `[${index}]`]]);
    }
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

describe("naming a net for annotation", () => {
  const bench = benchDesign();
  const benchSession = defaultSession(bench);
  const graph = buildLevel0Connectivity(bench, undefined, benchSession);

  it("names a scalar net so its value can be asked for", () => {
    const wire = sceneEdges(graph).find((e) => e.netId?.endsWith("#net:n0"))!;
    expect(netProbePath(bench, benchSession, wire.netId!)).toEqual(["tb", "clk_s"]);
  });

  it("declines an unpacked array, which has no single value", () => {
    const wire = sceneEdges(graph).find((e) => e.netId?.endsWith("#net:n1"))!;
    expect(netProbePath(bench, benchSession, wire.netId!)).toBeNull();
  });

  it("declines anything that is not a net id", () => {
    expect(netProbePath(bench, benchSession, "not-a-net")).toBeNull();
  });
});

describe("revealing without leaving the scope", () => {
  it("opens the instances between here and the signal, in place", () => {
    const bench = benchDesign();
    const session = defaultSession(bench);
    const plan = revealPath(bench, session, ["tb", "u_dut", "clk_i"]);
    expect(plan).not.toBeNull();
    // the scope is untouched
    expect(plan!.session.moduleId).toBe(session.moduleId);
    expect(plan!.session.path).toEqual(["tb"]);
    // and the instance holding it is open
    expect([...plan!.session.expansion]).toContain("tb#i0");
    expect(plan!.netId).toBe("tb/u_dut#net:n2");
  });

  it("names the occurrence, so sibling instances do not collide", () => {
    const bench = benchDesign();
    const plan = revealPath(bench, defaultSession(bench), ["tb", "u_dut", "d_i"]);
    expect(plan!.netId.startsWith("tb/u_dut#net:")).toBe(true);
  });

  it("needs nothing opened for a signal already in scope", () => {
    const bench = benchDesign();
    const session = defaultSession(bench);
    const plan = revealPath(bench, session, ["tb", "clk_s"]);
    expect(plan!.session.expansion.size).toBe(0);
    expect(plan!.netId).toBe("tb#net:n0");
  });

  it("clears an isolated view, which would hide what was asked for", () => {
    const bench = benchDesign();
    const session = { ...defaultSession(bench), visible: new Set(["something"]) };
    expect(revealPath(bench, session, ["tb", "clk_s"])!.session.visible).toBeUndefined();
  });

  it("reports nothing for a signal outside the scope on screen", () => {
    const bench = benchDesign();
    const inner = { ...defaultSession(bench), moduleId: "m1", path: ["tb", "u_dut"] };
    expect(revealPath(bench, inner, ["tb", "clk_s"])).toBeNull();
  });
});
