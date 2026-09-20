import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBox, findNet, hopAtBoundary, snippet } from "@ossschem/graph";
import { prettyNet, type Design } from "@ossschem/ir";
import { ingestToIr, parseVerilatorDump } from "@ossschem/ingest-verilator";
import { describe, expect, it } from "vitest";
import { buildLevel0, buildLevel0Connectivity, defaultSession } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const design: Design = ingestToIr(
  parseVerilatorDump(
    JSON.parse(readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.tree.json"), "utf8")),
    JSON.parse(readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.meta.json"), "utf8")),
  ),
  { verilatorVersion: "5.046", dumpedAt: "2026-09-18T00:00:00.000Z", topName: "svb_afifo" },
);
const top = design.modules[design.top];
const src = readFileSync(resolve(root, "fixtures/svb_afifo/src/svb_afifo.sv"), "utf8");
const syncSrc = readFileSync(resolve(root, "fixtures/svb_afifo/src/svb_sync.sv"), "utf8");

describe("acceptance A–H", () => {
  it("A: 12 ports, named processes, 2 arrays, no genblk3", () => {
    const nodes = buildLevel0(design);
    expect(top.ports).toHaveLength(12);
    expect(nodes.filter((n) => n.kind === "instanceArray")).toHaveLength(2);
    expect(nodes.some((n) => n.title === "genblk3")).toBe(false);
    expect(findNet(top, "i")).toBeUndefined();
    expect(findBox(top, "proc_fifo_mem_r")).toBeDefined();
  });

  it("B: explode wpointer array to 5 members", () => {
    const sess = defaultSession(design);
    const arr = buildLevel0(design).find((n) => n.title === "u_svb_sync_gray_wpointer");
    expect(arr).toBeDefined();
    if (arr === undefined) {
      return;
    }
    sess.exploded.add(arr.key);
    const nodes = buildLevel0(design, top, sess);
    expect(nodes.filter((n) => n.kind === "instance" && n.title.startsWith("u_svb_sync_gray_wpointer"))).toHaveLength(5);
    expect(nodes.filter((n) => n.kind === "instanceArray")).toHaveLength(1);
  });

  it("C: gray expr exact string", () => {
    const box = findBox(top, "proc_pointer_next");
    const net = findNet(top, "gray_wpointer_next_s");
    expect(prettyNet(net!.id, box!.contents)).toBe("(bin_wpointer_next_s >> 1) ^ bin_wpointer_next_s");
  });

  it("D: full_o traces back to assign box", () => {
    const fullO = buildLevel0(design).find((n) => n.title === "full_o")!;
    const hop = hopAtBoundary(design, fullO.key, "back");
    const titles = hop.map((k) => buildLevel0(design).find((n) => n.key === k)?.title);
    expect(titles).toContain("assign full_o");
  });

  it("E: source spans exclude decl sites", () => {
    const full = findBox(top, "proc_full")!;
    expect(full.span.startLine).toBe(150);
    expect(full.span.endLine).toBe(156);
    const sn = snippet(src, full.span, 0);
    expect(sn.hl[0]).toBe(150);
    const assign = findBox(top, "assign full_o")!;
    expect(assign.span.startLine).toBe(160);
    expect(assign.span.startLine).not.toBe(59);
    const empty = findBox(top, "assign empty_o")!;
    expect(empty.span.startLine).toBe(147);
    expect(empty.span.startLine).not.toBe(61);
  });

  it("F/H: clocks collapsed, datapath edged", () => {
    const conn = buildLevel0Connectivity(design);
    expect(conn.collapsed.map((c) => c.netName).sort()).toEqual([
      "clk_r_i",
      "clk_w_i",
      "rst_r_an_i",
      "rst_w_an_i",
    ]);
    expect(conn.edges.some((e) => e.netName === "full_s")).toBe(true);
  });

  it("G: memory + RST_VAL=1", () => {
    expect(findBox(top, "proc_fifo_mem_w")!.contents.cells.some((c) => c.kind === "memwr")).toBe(true);
    const empty = findBox(top, "proc_empty")!.contents.cells.find(
      (c) => c.kind === "adff" && c.pins.Q?.net === findNet(top, "empty_r")?.id,
    );
    expect(String(empty?.params?.RST_VAL)).toMatch(/^(1|1'b1)$/);
  });

  it("E sync d_o excludes decl 38", () => {
    const sync = Object.values(design.modules).find((m) => m.name === "svb_sync")!;
    const dO = sync.boxes.find((b) => b.name === "assign d_o")!;
    expect(dO.span.startLine).toBe(51);
    expect(dO.span.startLine).not.toBe(38);
    expect(snippet(syncSrc, dO.span, 0).hl[0]).toBe(51);
  });
});

describe("visible hierarchy tracing", () => {
  it("traces a single wire and an expanded primitive pin", () => {
    const session = defaultSession(design);
    const box = buildLevel0(design).find(n => n.title === "proc_full")!;
    session.expansion.add(box.key);
    const graph = buildLevel0Connectivity(design, undefined, session);
    const expanded = graph.nodes.find(n => n.key === box.key)!;
    const edge = expanded.interiorEdges![0];
    for (const selected of [edge.key, edge.targetPin]) {
      const result = hopAtBoundary(design, selected, "back", session);
      expect(result).toContain(edge.sourceKey);
      expect(result).toContain(edge.key);
      expect(result).not.toContain(graph.nodes.find(n => n.title === "proc_empty")!.key);
    }
  });

  it("keeps siblings visible, scopes internal nets, and connects expanded instances", () => {
    const session = defaultSession(design);
    const array = buildLevel0(design).find(n => n.kind === "instanceArray")!;
    session.exploded.add(array.key);
    const members = buildLevel0(design, undefined, session).filter(n => n.kind === "instance");
    members.slice(0, 2).forEach(n => session.expansion.add(n.key));
    const graph = buildLevel0Connectivity(design, undefined, session);
    const a = graph.nodes.find(n => n.key === members[0].key)!;
    const b = graph.nodes.find(n => n.key === members[1].key)!;
    expect(a.children!.length).toBeGreaterThan(0);
    expect(b.children!.length).toBeGreaterThan(0);
    expect(graph.nodes.some(n => n.title === "proc_full")).toBe(true);
    const internalA = a.children!.flatMap(n => n.pins).filter(p => !a.pins.some(x => x.netId === p.netId));
    const internalB = new Set(b.children!.flatMap(n => n.pins).map(p => p.netId));
    expect(internalA.length).toBeGreaterThan(0);
    expect(internalA.some(p => internalB.has(p.netId))).toBe(false);
    const edge = a.interiorEdges!.find(e => e.targetKey === a.key)!;
    expect(hopAtBoundary(design, edge.targetPin, "back", session)).toContain(edge.sourceKey);
    expect(session.moduleId).toBe(design.top);
  });

  it("renders ordinary instances outside generate arrays", () => {
    const copy = structuredClone(design);
    copy.modules[copy.top].instances = copy.modules[copy.top].instances.filter(i => i.kind === "instance");
    expect(buildLevel0(copy).filter(n => n.kind === "instance")).toHaveLength(copy.modules[copy.top].instances.length);
  });
});
