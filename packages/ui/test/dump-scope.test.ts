import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Design } from "@ossschem/ir";
import type { ProbeProvider, ScopeSource } from "../src/probe.js";
import { confirmScope, findLikelyScope, learnScope, scopedProbe } from "../src/dump-scope.js";

const design = JSON.parse(
  readFileSync(new URL("../../../fixtures/svb_afifo/golden/schematic-ir.json", import.meta.url), "utf8"),
) as Design;
const top = design.modules[design.top];
const port = top.ports[0].name;

/* Every signal of the design, named the way a dump that holds it under `scope` would. */
function dumpOf(scope: string[]): string[] {
  const names: string[] = [];
  const walk = (moduleId: string, prefix: string[]): void => {
    const mod = design.modules[moduleId];
    for (const net of mod.nets) names.push([...prefix, net.name].join("."));
    for (const instance of mod.instances) {
      if (instance.kind === "instance") walk(instance.module, [...prefix, ...instance.relPath]);
    }
  };
  walk(design.top, scope);
  return names;
}

/* A testbench that wires up the design the usual way: a signal for every one
 * of its ports, named after it, at the testbench's own level. */
const testbench = ["TOP.tb.clk_gen", ...top.ports.map((p) => `TOP.tb.${p.name}`)];

/* Answers the way vaporview does: only for names the dump has. */
function fakeViewer(names: string[]) {
  const known = new Set(names);
  const scopes: [string[] | undefined, ScopeSource][] = [];
  const notes: [string, string][] = [];
  const picked: string[] = [];
  let reveal: ((path: string[]) => unknown) | undefined;
  const host: ProbeProvider = {
    resolve: () => null,
    values: async (paths) =>
      Object.fromEntries(paths.map((p) => p.join(".")).filter((p) => known.has(p)).map((p) => [p, ["1"]])),
    useScope: (scope, source) => { scopes.push([scope, source]); },
    notify: (message, level) => { notes.push([message, level]); },
    onNetPicked: (refs) => { picked.push(...refs.map((r) => r.path.join("."))); },
    onRevealRequest: (cb) => { reveal = cb; return () => { reveal = undefined; }; },
  };
  return { host, scopes, notes, picked, reveal: async (dotted: string) => { await reveal?.(dotted.split(".")); } };
}

describe("placing the design in a dump before anything is learned", () => {
  it("takes the design's own names when the dump uses them", async () => {
    expect(await findLikelyScope(fakeViewer(dumpOf([top.name])).host, design)).toEqual([top.name]);
  });

  it("finds it under Verilator's TOP", async () => {
    expect(await findLikelyScope(fakeViewer(dumpOf(["TOP", top.name])).host, design)).toEqual(["TOP", top.name]);
  });

  it("leaves a testbench's own naming to be learned", async () => {
    const { host } = fakeViewer([...testbench, ...dumpOf(["TOP", "tb", "u_fifo"])]);
    expect(await findLikelyScope(host, design)).toBeUndefined();
  });
});

describe("learning the scope from one dump signal", () => {
  const { host } = fakeViewer([...testbench, ...dumpOf(["TOP", "tb", "u_fifo"])]);

  it("learns it from a signal of the design", async () => {
    expect(await learnScope(host, design, ["TOP", "tb", "u_fifo", port])).toEqual(["TOP", "tb", "u_fifo"]);
  });

  it("is not fooled by a testbench signal named after a port", async () => {
    // TOP.tb would pass on the ports alone; it has none of the design's instances
    expect(await confirmScope(host, design, ["TOP", "tb"])).toBe(false);
    expect(await learnScope(host, design, ["TOP", "tb", port])).toBeNull();
  });
});

describe("the probe under a scope", () => {
  const scope = ["TOP", "tb", "u_fifo"];
  const dump = [...testbench, ...dumpOf(scope)];

  it("sends the dump's names and answers in the schematic's", async () => {
    const viewer = fakeViewer(dump);
    const probe = scopedProbe(viewer.host, design, scope, "auto");
    probe.onNetPicked?.([{ path: [top.name, port], net: port }]);
    expect(viewer.picked).toEqual([`TOP.tb.u_fifo.${port}`]);
    expect(await probe.values?.([[top.name, port], [top.name, "no_such_signal"]])).toEqual({ [`${top.name}.${port}`]: ["1"] });
  });

  it("reveals a dump signal under its schematic name", async () => {
    const viewer = fakeViewer(dump);
    const shown: string[][] = [];
    scopedProbe(viewer.host, design, scope, "manual").onRevealRequest?.((path) => { shown.push(path); });
    await viewer.reveal(`TOP.tb.u_fifo.${port}`);
    expect(shown).toEqual([[top.name, port]]);
  });

  it("learns a better scope from a reveal it cannot place, and says so", async () => {
    const viewer = fakeViewer(dump);
    const shown: string[][] = [];
    scopedProbe(viewer.host, design, [top.name], undefined).onRevealRequest?.((path) => { shown.push(path); });
    await viewer.reveal(`TOP.tb.u_fifo.${port}`);
    expect(viewer.scopes).toEqual([[scope, "auto"]]);
    expect(shown).toEqual([[top.name, port]]);
    expect(viewer.notes[0]?.[1]).toBe("info");
  });

  it("keeps a scope the user set, and explains a signal outside it", async () => {
    const viewer = fakeViewer(dump);
    const shown: string[][] = [];
    scopedProbe(viewer.host, design, ["TOP", "elsewhere"], "manual").onRevealRequest?.((path) => { shown.push(path); });
    await viewer.reveal(`TOP.tb.u_fifo.${port}`);
    expect(viewer.scopes).toEqual([]);
    expect(shown).toEqual([]);
    expect(viewer.notes[0]?.[1]).toBe("warning");
  });

  it("explains a testbench signal rather than doing nothing", async () => {
    const viewer = fakeViewer(dump);
    scopedProbe(viewer.host, design, scope, "auto").onRevealRequest?.(() => { throw new Error("not the design's"); });
    await viewer.reveal("TOP.tb.clk_gen");
    expect(viewer.notes[0]?.[0]).toContain("outside");
  });
});
