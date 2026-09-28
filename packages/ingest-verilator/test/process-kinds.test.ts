import { describe, expect, it } from "vitest";
import type { Net, Primitive, PrimitiveGraph } from "@ossschem/ir";
import { IdMint } from "../src/ids.js";
import { lowerAlways } from "../src/lower.js";
import type { VerilatorDump } from "../src/parse.js";
import type { VerilatorNode } from "../src/types.js";

/* A case is a case and a mux is a mux: which process a statement sits in
 * decides only whether the result is registered, never how it is read. */
const dump = { loc: () => undefined } as unknown as VerilatorDump;

function net(id: string, name: string, bits: number): Net {
  return {
    id, name, width: { msb: bits - 1, lsb: 0, packed: true }, kind: "reg",
    span: { fileId: "?", file: "", startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    drivers: [], loads: [],
  };
}

const nets = new Map([
  ["sel", net("n0", "sel", 2)],
  ["y", net("n1", "y", 4)],
  ["a", net("n2", "a", 4)],
  ["b", net("n3", "b", 4)],
  ["en", net("n4", "en", 1)],
  ["clk", net("n5", "clk", 1)],
  ["bit", net("n6", "bit", 1)],
]);

const value = (text: string): VerilatorNode => ({ type: "CONST", name: text }) as VerilatorNode;
const read = (name: string): VerilatorNode => ({ type: "VARREF", name }) as VerilatorNode;
const assign = (name: string, rhs: VerilatorNode, type = "ASSIGN"): VerilatorNode =>
  ({ type, lhsp: [read(name)], rhsp: [rhs] }) as VerilatorNode;
const item = (conds: string[], stmts: VerilatorNode[]): VerilatorNode =>
  ({ type: "CASEITEM", condsp: conds.map(value), stmtsp: stmts }) as VerilatorNode;
const kase = (selector: string, items: VerilatorNode[], extra: Record<string, unknown> = {}): VerilatorNode =>
  ({ type: "CASE", kwd: "case", exprp: [read(selector)], itemsp: items, ...extra }) as VerilatorNode;
const ifThen = (cond: string, thens: VerilatorNode[], elses: VerilatorNode[] = []): VerilatorNode =>
  ({ type: "IF", condp: [read(cond)], thensp: thens, elsesp: elses }) as VerilatorNode;

function process(keyword: string, stmts: VerilatorNode[], clocked = false): VerilatorNode {
  return {
    type: "ALWAYS",
    keyword,
    ...(clocked ? { sentreep: [{ type: "SENTREE", sensesp: [{ type: "SENITEM", edgeType: "POS", sensp: [read("clk")] }] }] } : {}),
    stmtsp: [{ type: "BEGIN", name: "proc", stmtsp: stmts }],
  } as unknown as VerilatorNode;
}

const lower = (always: VerilatorNode): PrimitiveGraph => lowerAlways(dump, always, nets, new IdMint());
const driverOf = (g: PrimitiveGraph, id: string | undefined): Primitive | undefined =>
  g.cells.find((c) => c.pins.Y?.net === id);
const reads = (g: PrimitiveGraph, id: string): boolean =>
  g.cells.some((c) => Object.entries(c.pins).some(([pin, ref]) => pin !== "Y" && pin !== "Q" && ref.net === id));
const constOf = (g: PrimitiveGraph, id: string | undefined): string | undefined =>
  String(driverOf(g, id)?.params?.value);

// a unique case over every state, the shape of a next-state decode
const decode = (op: "ASSIGN" | "ASSIGNDLY", target: string): VerilatorNode => kase("sel", [
  item(["2'h0"], [assign(target, read("a"), op)]),
  item(["2'h1"], [assign(target, read("b"), op)]),
  item(["2'h2"], [assign(target, value("4'h5"), op)]),
  // what Verilator adds to a unique case: an assertion, no assignment
  item([], [ifThen("en", [{ type: "DISPLAY" } as VerilatorNode])]),
], { unique: true });

describe("the same case in every kind of process", () => {
  for (const keyword of ["always_comb", "always", "always_latch"]) {
    it(`${keyword}: one mux tree drives the signal, one compare per item`, () => {
      const g = lower(process(keyword, [decode("ASSIGN", "y")]));
      expect(g.cells.filter((c) => c.pins.Y?.net === "n1")).toHaveLength(1);
      expect(driverOf(g, "n1")?.kind).toBe("mux");
      const compares = g.cells.filter((c) => c.kind === "eq" && c.pins.A?.net === "n0");
      // the last item of a unique case is what is left, it needs no compare
      expect(compares.map((c) => constOf(g, c.pins.B?.net)).sort()).toEqual(["0", "1"]);
      // every path assigns, so nothing holds y
      expect(reads(g, "n1")).toBe(false);
      // the assertion Verilator adds leaves nothing behind
      expect(g.cells.some((c) => c.kind === "opaque")).toBe(false);
    });
  }

  it("clocked `always`: a register whose D is that mux tree", () => {
    const g = lower(process("always", [decode("ASSIGNDLY", "y")], true));
    const flop = g.cells.find((c) => c.pins.Q?.net === "n1");
    expect(flop?.kind).toBe("dff");
    expect(flop?.pins.CLK?.net).toBe("n5");
    expect(driverOf(g, flop?.pins.D?.net)?.kind).toBe("mux");
    expect(g.cells.filter((c) => c.kind === "eq")).toHaveLength(2);
  });
});

describe("case semantics", () => {
  it("the first matching item wins, so it is the outermost select", () => {
    const g = lower(process("always_comb", [
      assign("y", read("b")),
      kase("sel", [item(["2'h1"], [assign("y", read("a"))]), item(["2'h1", "2'h2"], [assign("y", value("4'h3"))])]),
    ]));
    const top = driverOf(g, "n1");
    expect(top?.pins.B?.net).toBe("n2");
    expect(constOf(g, driverOf(g, top?.pins.S?.net)?.pins.B?.net)).toBe("1");
  });

  it("items naming every selector value need no default", () => {
    const g = lower(process("always_comb", [
      kase("bit", [item(["1'h0"], [assign("y", read("a"))]), item(["1'h1"], [assign("y", read("b"))])]),
    ]));
    expect(g.cells.filter((c) => c.kind === "mux")).toHaveLength(1);
    expect(reads(g, "n1")).toBe(false);
  });

  it("casez compares only the bits an item cares about", () => {
    const g = lower(process("always_comb", [
      kase("sel", [item(["2'b1z"], [assign("y", read("a"))]), item([], [assign("y", read("b"))])], { kwd: "casez" }),
    ]));
    const eq = g.cells.find((c) => c.kind === "eq");
    const masked = driverOf(g, eq?.pins.A?.net);
    expect(masked?.kind).toBe("and");
    expect(masked?.pins.A?.net).toBe("n0");
    expect(constOf(g, masked?.pins.B?.net)).toBe("2");
    expect(constOf(g, eq?.pins.B?.net)).toBe("2");
  });
});

describe("paths that assign nothing", () => {
  for (const keyword of ["always_comb", "always_latch"]) {
    it(`${keyword}: hold the signal, which is the latch the code describes`, () => {
      const g = lower(process(keyword, [ifThen("en", [assign("y", read("a"))])]));
      const mux = driverOf(g, "n1");
      expect(mux?.kind).toBe("mux");
      expect(mux?.pins.S?.net).toBe("n4");
      expect(mux?.pins.B?.net).toBe("n2");
      expect(mux?.pins.A?.net).toBe("n1");
    });
  }

  it("a default assigned first leaves no hold", () => {
    const g = lower(process("always_comb", [assign("y", read("b")), ifThen("en", [assign("y", read("a"))])]));
    expect(driverOf(g, "n1")?.pins.A?.net).toBe("n3");
  });

  it("a register assigned only in an else branch is enabled by the inverted condition", () => {
    const g = lower(process("always_ff", [ifThen("en", [], [assign("y", read("a"), "ASSIGNDLY")])], true));
    const flop = g.cells.find((c) => c.pins.Q?.net === "n1");
    expect(flop?.kind).toBe("dffe");
    expect(flop?.pins.D?.net).toBe("n2");
    const en = driverOf(g, flop?.pins.EN?.net);
    expect(en?.kind).toBe("not");
    expect(en?.pins.A?.net).toBe("n4");
  });

  it("a register assigned in one case item is enabled by that item's match", () => {
    const g = lower(process("always_ff", [kase("sel", [item(["2'h2"], [assign("y", read("a"), "ASSIGNDLY")])])], true));
    const flop = g.cells.find((c) => c.pins.Q?.net === "n1");
    expect(flop?.kind).toBe("dffe");
    expect(flop?.pins.D?.net).toBe("n2");
    expect(driverOf(g, flop?.pins.EN?.net)?.kind).toBe("eq");
  });
});
