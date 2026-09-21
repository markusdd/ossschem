import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeDesign, type Design, type Module } from "@ossschem/ir";
import { describe, expect, it } from "vitest";
import { ingestToIr, parseVerilatorDump } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const tree = JSON.parse(
  readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.tree.json"), "utf8"),
) as unknown;
const meta = JSON.parse(
  readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.meta.json"), "utf8"),
) as unknown;
const manifest = JSON.parse(
  readFileSync(resolve(root, "fixtures/svb_afifo/manifest.json"), "utf8"),
) as { verilator: string };

function load(): { design: Design; top: Module } {
  const dump = parseVerilatorDump(tree, meta);
  const design = ingestToIr(dump, {
    verilatorVersion: manifest.verilator,
    dumpedAt: "2026-09-18T00:00:00.000Z",
    topName: "svb_afifo",
  });
  const top = design.modules[design.top];
  return { design, top };
}

describe("ingestToIr(svb_afifo) Scene A subset", () => {
  const { design, top } = load();

  it("selects svb_afifo as top and also emits svb_sync", () => {
    expect(top.name).toBe("svb_afifo");
    const names = Object.values(design.modules).map((m) => m.name).sort();
    expect(names).toEqual(["svb_afifo", "svb_sync"]);
  });

  it("has 12 top ports with RTL names and directions", () => {
    expect(top.ports).toHaveLength(12);
    expect(top.ports.map((p) => `${p.dir} ${p.name}`)).toEqual([
      "input clk_w_i",
      "input rst_w_an_i",
      "input wen_i",
      "input wdata_i",
      "output full_o",
      "output werr_o",
      "input clk_r_i",
      "input rst_r_an_i",
      "input ren_i",
      "output rdata_o",
      "output empty_o",
      "output rerr_o",
    ]);
  });

  it("records param values 32/16/1/4", () => {
    const byName = Object.fromEntries(top.params.map((p) => [p.name, p.value]));
    expect(byName).toMatchObject({
      DATA_WIDTH: "32",
      DEPTH: "16",
      RDATA_REG: "1",
      ADDR_WIDTH_P: "4",
    });
  });

  it("classifies nets: full_r reg, fifo_mem_r memory, no GENVAR i", () => {
    const byName = Object.fromEntries(top.nets.map((n) => [n.name, n]));
    expect(byName.full_r.kind).toBe("reg");
    expect(byName.full_r.width).toEqual({ msb: 0, lsb: 0, packed: true });
    expect(byName.full_s.kind).toBe("wire");
    expect(byName.gray_wpointer_r.width).toEqual({ msb: 4, lsb: 0, packed: true });
    expect(byName.fifo_mem_r.kind).toBe("memory");
    expect(byName.fifo_mem_r.memory).toEqual({
      depth: 16,
      packed: { msb: 31, lsb: 0, packed: true },
      // the declared index range, which names the elements in a dump
      range: { msb: 15, lsb: 0 },
    });
    expect(byName.i).toBeUndefined();
    expect(top.nets.some((n) => n.name === "i")).toBe(false);
  });

  it("emits two svb_sync InstanceArrays [4:0] and ten members", () => {
    const arrays = top.instances.filter((x) => x.kind === "instanceArray");
    const members = top.instances.filter((x) => x.kind === "instance");
    expect(arrays.map((a) => a.name).sort()).toEqual([
      "u_svb_sync_gray_rpointer",
      "u_svb_sync_gray_wpointer",
    ]);
    expect(arrays.every((a) => a.range.msb === 4 && a.range.lsb === 0)).toBe(true);
    expect(arrays.every((a) => a.generate === "gen_pointer_sync")).toBe(true);
    expect(members).toHaveLength(10);
    expect(top.instances.some((x) => x.name === "gen_pointer_sync" || x.name === "genblk3")).toBe(
      false,
    );

    const syncId = Object.values(design.modules).find((m) => m.name === "svb_sync")?.id;
    expect(arrays.every((a) => a.module === syncId)).toBe(true);

    const w0 = members.find(
      (m) => m.name === "u_svb_sync_gray_wpointer" && m.arrayIndex === 0,
    );
    expect(w0?.relPath).toEqual(["gen_pointer_sync[0]", "u_svb_sync_gray_wpointer"]);
    const clk = w0?.pins.find((p) => p.port === "clk_i");
    const clkNet = top.nets.find((n) => n.id === clk?.net);
    expect(clkNet?.name).toBe("clk_r_i");
    const di = w0?.pins.find((p) => p.port === "d_i");
    const diNet = top.nets.find((n) => n.id === di?.net);
    expect(diNet?.name).toBe("gray_wpointer_r");
    expect(di?.bits).toEqual({ msb: 0, lsb: 0 });
  });

  it("serializes with sorted keys", () => {
    const json = serializeDesign(design);
    expect(json.startsWith("{\n  \"files\"")).toBe(true);
    const parsed = JSON.parse(json) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(1);
  });
});
