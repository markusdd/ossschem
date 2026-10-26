import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { main, metaCandidates, planPassthrough, splitPassthrough } from "../src/main.js";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/svb_afifo/verilator");

describe("arguments handed through to Verilator", () => {
  it("splits at the first --, leaving everything after it alone", () => {
    expect(splitPassthrough(["--top", "t", "a.sv", "--", "-pvalue+N=1", "--", "b.sv"])).toEqual({
      own: ["--top", "t", "a.sv"],
      passthrough: ["-pvalue+N=1", "--", "b.sv"],
    });
    expect(splitPassthrough(["--top", "t", "a.sv"])).toEqual({ own: ["--top", "t", "a.sv"], passthrough: [] });
  });

  it("passes a simulation's flag set through as it is", () => {
    const flags = ["--cc", "--timing", "--coverage-user", "--error-limit", "5", "--trace-vcd",
      "--timescale-override", "1ns/1ps", "-pvalue+CLK_RATE_HZ=125e6", "+define+SIM", "-Iinc",
      "-f", "files.f", "--Mdir", "tmp/vltd", "sim/top.v"];
    expect(planPassthrough(flags)).toEqual({ args: flags, dropped: [] });
  });

  it("takes the top from --top-module or --top, in either spelling", () => {
    expect(planPassthrough(["--top-module", "top", "a.sv"])).toEqual({ args: ["a.sv"], top: "top", dropped: [] });
    expect(planPassthrough(["-top-module", "top"]).top).toBe("top");
    expect(planPassthrough(["--top", "a", "--top", "b"]).top).toBe("b");
  });

  it("leaves out what --json-only refuses and where the JSON goes, and says so", () => {
    const plan = planPassthrough(["--binary", "-build", "--json-only-output", "x.json", "a.sv"]);
    expect(plan.args).toEqual(["a.sv"]);
    expect(plan.dropped).toHaveLength(3);
    expect(plan.dropped[2]).toContain("x.json");
  });
});

describe("the meta JSON next to a tree", () => {
  it("follows Verilator's naming, then build's", () => {
    expect(metaCandidates("out/Vtop.tree.json")).toEqual(["out/Vtop.tree.meta.json", "out/Vtop.meta.json"]);
    expect(metaCandidates("top.json")).toEqual(["top.meta.json"]);
  });
});

describe("build --json", () => {
  let out: string | undefined;
  afterEach(() => {
    if (out !== undefined) rmSync(out, { recursive: true, force: true });
  });

  it("builds the viewer from JSON already written, finding the meta itself", () => {
    out = mkdtempSync(join(tmpdir(), "ossschem-json-"));
    const status = main(["build", "--json", "--out-dir", out, "--verilator-version", "5.046",
      join(fixture, "svb_afifo.tree.json")]);
    expect(status).toBe(0);
    const design = JSON.parse(readFileSync(join(out, "schematic-ir.json"), "utf8")) as { top: string; modules: Record<string, { name: string }> };
    expect(design.modules[design.top]?.name).toBe("svb_afifo");
    expect(existsSync(join(out, "index.html"))).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(join(out, "sources.json"), "utf8")) as object)).toContain("svb_afifo.sv");
  });

  it("refuses arguments for a Verilator it does not run", () => {
    expect(main(["build", "--json", join(fixture, "svb_afifo.tree.json"), "--", "--timing"])).toBe(1);
  });
});
