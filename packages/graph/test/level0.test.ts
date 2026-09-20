import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Design } from "@ossschem/ir";
import { describe, expect, it } from "vitest";
import { buildLevel0, buildLevel0Connectivity, defaultSession, hopAtBoundary } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const design = JSON.parse(
  readFileSync(resolve(root, "fixtures/svb_afifo/golden/schematic-ir.json"), "utf8"),
) as Design;

describe("buildLevel0(svb_afifo)", () => {
  const nodes = buildLevel0(design);

  it("shows 12 ports, 10 boxes, 2 arrays (not 10 instances)", () => {
    expect(nodes.filter((n) => n.kind === "port")).toHaveLength(12);
    expect(nodes.filter((n) => n.kind === "always")).toHaveLength(7);
    expect(nodes.filter((n) => n.kind === "assign")).toHaveLength(3);
    expect(nodes.filter((n) => n.kind === "instanceArray")).toHaveLength(2);
    expect(nodes.some((n) => n.title === "genblk3")).toBe(false);
    expect(nodes.some((n) => n.title === "u_svb_sync_gray_wpointer")).toBe(true);
    const full = nodes.find((n) => n.title === "proc_full");
    expect(full?.pins.some((p) => p.name === "full_s")).toBe(true);
    expect(full?.pins.some((p) => p.name === "full_r" && p.side === "E")).toBe(true);
    expect(full?.children).toBeUndefined();
  });

  it("expands proc_full in place with interior children, not sibling primitives", () => {
    const sess = defaultSession(design);
    const full = nodes.find((n) => n.title === "proc_full")!;
    sess.expansion.add(full.key);
    const expanded = buildLevel0(design, undefined, sess);
    const parent = expanded.find((n) => n.title === "proc_full");
    expect(parent?.children?.length).toBeGreaterThan(0);
    expect(expanded.filter((n) => n.kind === "primitive")).toHaveLength(0);
    expect(expanded.filter((n) => n.kind === "always")).toHaveLength(7);
    expect((parent?.interiorEdges ?? []).length).toBeGreaterThan(0);
    expect(parent?.children?.some((c) => c.symbol === "adff")).toBe(true);
  });

  it("collapses clock/reset nets and keeps datapath edges (Scene H)", () => {
    const conn = buildLevel0Connectivity(design);
    const collapsed = conn.collapsed.map((c) => c.netName).sort();
    expect(collapsed).toEqual(["clk_r_i", "clk_w_i", "rst_r_an_i", "rst_w_an_i"]);
    expect(conn.edges.some((e) => e.netName === "full_s")).toBe(true);
    expect(conn.edges.some((e) => e.netName === "clk_w_i")).toBe(false);
  });

  it("traces full_o back to assign full_o (stop at box)", () => {
    const fullO = nodes.find((n) => n.title === "full_o");
    expect(fullO).toBeDefined();
    if (fullO === undefined) {
      return;
    }
    const hop = hopAtBoundary(design, fullO.key, "back");
    const titles = hop
      .map((k) => nodes.find((n) => n.key === k)?.title)
      .filter((t): t is string => t !== undefined);
    expect(titles).toContain("full_o");
    expect(titles).toContain("assign full_o");
  });
});

