import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBox, findNet } from "@ossschem/graph";
import { prettyNet } from "@ossschem/ir";
import { describe, expect, it } from "vitest";
import { ingestToIr, parseVerilatorDump } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const design = ingestToIr(
  parseVerilatorDump(
    JSON.parse(readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.tree.json"), "utf8")),
    JSON.parse(readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.meta.json"), "utf8")),
  ),
  { verilatorVersion: "5.046", dumpedAt: "2026-09-18T00:00:00.000Z", topName: "svb_afifo" },
);
const top = design.modules[design.top];
const sync = Object.values(design.modules).find((m) => m.name === "svb_sync");

function cells(name: string) {
  const box = findBox(top, name);
  expect(box).toBeDefined();
  return box?.contents.cells ?? [];
}

describe("sequential lowering (Scene G)", () => {
  it("proc_full: adff full_r RST_VAL=0", () => {
    const c = cells("proc_full").find((x) => x.kind === "adff" && x.pins.Q?.net === findNet(top, "full_r")?.id);
    expect(c).toBeDefined();
    expect(String(c?.params?.RST_VAL)).toMatch(/^(0|1'b0)$/);
  });

  it("proc_empty: adff empty_r RST_VAL=1", () => {
    const c = cells("proc_empty").find((x) => x.kind === "adff" && x.pins.Q?.net === findNet(top, "empty_r")?.id);
    expect(c).toBeDefined();
    expect(String(c?.params?.RST_VAL)).toMatch(/^(1|1'b1)$/);
  });

  it("proc_w_pointer: adffe on bin_wpointer_r", () => {
    const c = cells("proc_w_pointer").find(
      (x) => x.kind === "adffe" && x.pins.Q?.net === findNet(top, "bin_wpointer_r")?.id,
    );
    expect(c).toBeDefined();
    expect(c?.pins.EN).toBeDefined();
  });

  it("proc_fifo_mem_w: memwr", () => {
    expect(cells("proc_fifo_mem_w").some((x) => x.kind === "memwr")).toBe(true);
  });

  it("proc_fifo_mem_r: memrd + dffe", () => {
    const c = cells("proc_fifo_mem_r");
    expect(c.some((x) => x.kind === "memrd")).toBe(true);
    expect(c.some((x) => x.kind === "dffe" && x.pins.Q?.net === findNet(top, "rdata_r")?.id)).toBe(true);
  });

  it("proc_sync: two adff RST_VAL=0", () => {
    const box = sync?.boxes.find((b) => b.name === "proc_sync");
    const adffs = box?.contents.cells.filter((c) => c.kind === "adff") ?? [];
    expect(adffs.length).toBe(2);
  });
});

describe("combo lowering (Scene C)", () => {
  it("proc_pointer_next has add, shiftr, xor, eq, concat", () => {
    const kinds = new Set(cells("proc_pointer_next").map((c) => c.kind));
    for (const k of ["add", "shiftr", "xor", "eq", "concat", "not", "slice"] as const) {
      expect(kinds.has(k)).toBe(true);
    }
  });

  it("gray_wpointer_next_s pretty-prints with nested parens, no root wrap, shift 1", () => {
    const box = findBox(top, "proc_pointer_next");
    const net = findNet(top, "gray_wpointer_next_s");
    expect(box && net).toBeTruthy();
    if (box === undefined || net === undefined) {
      return;
    }
    expect(prettyNet(net.id, box.contents)).toBe("(bin_wpointer_next_s >> 1) ^ bin_wpointer_next_s");
  });
});
