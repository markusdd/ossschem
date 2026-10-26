import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Design } from "@ossschem/ir";
import { fromDumpPath, inferDumpScope, likelyDumpScopes, scopeWitnesses, splitDumpPath, toDumpPath } from "../src/index.js";

const design = JSON.parse(
  readFileSync(new URL("../../../fixtures/svb_afifo/golden/schematic-ir.json", import.meta.url), "utf8"),
) as Design;
const top = design.modules[design.top];
const port = top.ports[0].name;
const instance = top.instances.find((i) => i.kind === "instance")!;
const innerNet = design.modules[instance.module].nets[0].name;

describe("the design's place in a dump", () => {
  const scope = ["TOP", "tb", "u_fifo"];

  it("swaps the top's name for the scope and back", () => {
    expect(toDumpPath([top.name, port], scope)).toEqual([...scope, port]);
    expect(fromDumpPath([...scope, port], scope, top.name)).toEqual([top.name, port]);
    expect(fromDumpPath(toDumpPath([top.name, ...instance.relPath, innerNet], scope), scope, top.name))
      .toEqual([top.name, ...instance.relPath, innerNet]);
  });

  it("leaves names alone when the scope is the top itself", () => {
    expect(toDumpPath([top.name, port], [top.name])).toEqual([top.name, port]);
    expect(fromDumpPath([top.name, port], [top.name], top.name)).toEqual([top.name, port]);
  });

  it("has nothing to say about signals outside the scope, or the scope itself", () => {
    expect(fromDumpPath(["TOP", "tb", "clk"], scope, top.name)).toBeNull();
    expect(fromDumpPath(["TOP", "tb", "u_fifo_other", port], scope, top.name)).toBeNull();
    expect(fromDumpPath(scope, scope, top.name)).toBeNull();
  });

  it("reads a dotted dump name, array elements included", () => {
    expect(splitDumpPath("TOP.tb.mem.[3]")).toEqual(["TOP", "tb", "mem", "[3]"]);
  });
});

describe("finding the scope from one dump signal", () => {
  it("takes the prefix under which the rest is a signal of the design", () => {
    expect(inferDumpScope(design, ["TOP", "tb", "u_fifo", port])).toEqual(["TOP", "tb", "u_fifo"]);
    expect(inferDumpScope(design, ["sim", "dut", ...instance.relPath, innerNet])).toEqual(["sim", "dut"]);
  });

  it("finds the design named as itself", () => {
    expect(inferDumpScope(design, [top.name, port])).toEqual([top.name]);
  });

  it("prefers the longest remainder that resolves", () => {
    // the instance's net, reached through the instance, rather than a top net
    // that the shorter remainder would have to be
    expect(inferDumpScope(design, ["TOP", "dut", ...instance.relPath, innerNet])).toEqual(["TOP", "dut"]);
  });

  it("finds nothing for a testbench signal", () => {
    expect(inferDumpScope(design, ["TOP", "tb", "clk_gen", "no_such_signal"])).toBeNull();
  });
});

describe("before anything is learned", () => {
  it("tries the design's own names, then Verilator's TOP", () => {
    expect(likelyDumpScopes(design)).toEqual([[top.name], ["TOP", top.name]]);
  });

  it("checks a scope against the top's ports and one instance's, which a testbench does not mirror", () => {
    const witnesses = scopeWitnesses(design, 2);
    const instancePort = design.modules[instance.module].ports[0].name;
    expect(witnesses).toEqual([
      ...top.ports.slice(0, 2).map((p) => [top.name, p.name]),
      [top.name, ...instance.relPath, instancePort],
    ]);
  });
});
