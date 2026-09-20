import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBox, findNet, portDrivers } from "@ossschem/graph";
import { describe, expect, it } from "vitest";
import { ingestToIr, parseVerilatorDump } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dump = parseVerilatorDump(
  JSON.parse(readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.tree.json"), "utf8")),
  JSON.parse(readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.meta.json"), "utf8")),
);
const design = ingestToIr(dump, {
  verilatorVersion: "5.046",
  dumpedAt: "2026-09-18T00:00:00.000Z",
  topName: "svb_afifo",
});
const top = design.modules[design.top];
const sync = Object.values(design.modules).find((m) => m.name === "svb_sync");

describe("Always/Assign boxes (Scene A remainder)", () => {
  it("names processes and assigns on AFIFO", () => {
    const always = top.boxes.filter((b) => b.kind === "always").map((b) => b.name).sort();
    const assigns = top.boxes.filter((b) => b.kind === "assign").map((b) => b.name).sort();
    expect(always).toEqual([
      "proc_empty",
      "proc_fifo_mem_r",
      "proc_fifo_mem_w",
      "proc_full",
      "proc_pointer_next",
      "proc_r_pointer",
      "proc_w_pointer",
    ]);
    expect(assigns).toEqual(["assign empty_o", "assign full_o", "assign rdata_o"]);
    expect(top.boxes.some((b) => b.name === "genblk3")).toBe(false);
  });

  it("tags combo vs ff clocks/resets from SENITEM", () => {
    const comb = findBox(top, "proc_pointer_next");
    expect(comb?.kind).toBe("always");
    if (comb?.kind === "always") {
      expect(comb.keyword).toBe("always_comb");
      expect(comb.clocks).toEqual([]);
      expect(comb.resets).toEqual([]);
    }
    const full = findBox(top, "proc_full");
    expect(full?.kind).toBe("always");
    if (full?.kind === "always") {
      expect(full.keyword).toBe("always_ff");
      expect(full.clocks.map((c) => c.edge)).toEqual(["pos"]);
      expect(full.resets.map((c) => c.edge)).toEqual(["neg"]);
      expect(findNet(top, "clk_w_i")?.id).toBe(full.clocks[0]?.net);
      expect(findNet(top, "rst_w_an_i")?.id).toBe(full.resets[0]?.net);
    }
  });

  it("lowers every box to a non-empty contents graph", () => {
    for (const box of top.boxes) {
      expect(box.contents.cells.length).toBeGreaterThan(0);
    }
  });

  it("gives full_o a box driver and clk_w_i a port driver", () => {
    const fullO = findNet(top, "full_o");
    const boxDrv = fullO?.drivers.filter((d) => d.kind === "box");
    expect(boxDrv).toHaveLength(1);
    expect(top.boxes.find((b) => b.id === boxDrv?.[0]?.box)?.name).toBe("assign full_o");
    expect(portDrivers(top, "clk_w_i")).toHaveLength(1);
    expect(portDrivers(top, "full_o")).toHaveLength(0);
  });

  it("assigns same-line spans (not decl sites)", () => {
    const fullAssign = findBox(top, "assign full_o");
    expect(fullAssign?.span.startLine).toBe(160);
    expect(fullAssign?.span.endLine).toBe(160);
    expect(fullAssign?.span.startLine).not.toBe(59);
    const emptyAssign = findBox(top, "assign empty_o");
    expect(emptyAssign?.span.startLine).toBe(147);
    expect(emptyAssign?.span.startLine).not.toBe(61);
  });

  it("unions proc_full to lines 150–156", () => {
    const full = findBox(top, "proc_full");
    expect(full?.span.startLine).toBe(150);
    expect(full?.span.endLine).toBe(156);
  });

  it("emits svb_sync proc_sync + assign d_o", () => {
    expect(sync).toBeDefined();
    if (sync === undefined) {
      return;
    }
    expect(sync.boxes.map((b) => b.name).sort()).toEqual(["assign d_o", "proc_sync"]);
  });
});
