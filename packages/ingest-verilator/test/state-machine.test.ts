import { describe, expect, it } from "vitest";
import { prettyNet } from "@ossschem/ir";
import type { Net, Primitive } from "@ossschem/ir";
import { IdMint } from "../src/ids.js";
import { lowerAlways } from "../src/lower.js";
import type { VerilatorDump } from "../src/parse.js";
import type { VerilatorNode } from "../src/types.js";

/* A state machine assigns its register in every branch of a case, and what it
 * assigns are constants. Nothing about that is one expression with an enable,
 * so the lowering has to read the branches as the mux tree they are. */
const dump = { loc: () => undefined } as unknown as VerilatorDump;

function net(id: string, name: string, bits = 3): Net {
  return {
    id, name, width: { msb: bits - 1, lsb: 0, packed: true }, kind: "reg",
    span: { fileId: "?", file: "", startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    drivers: [], loads: [],
  };
}

const value = (text: string): VerilatorNode => ({ type: "CONST", name: text }) as VerilatorNode;
const read = (name: string): VerilatorNode => ({ type: "VARREF", name }) as VerilatorNode;
const assign = (name: string, rhs: VerilatorNode): VerilatorNode =>
  ({ type: "ASSIGNDLY", lhsp: [read(name)], rhsp: [rhs] }) as VerilatorNode;

const fsm = {
  type: "ALWAYS",
  keyword: "always_ff",
  sentreep: [{
    type: "SENTREE",
    sensesp: [
      { type: "SENITEM", edgeType: "POS", sensp: [read("clk_i")] },
      { type: "SENITEM", edgeType: "NEG", sensp: [read("rst_an_i")] },
    ],
  }],
  stmtsp: [{
    type: "BEGIN",
    name: "proc_fsm",
    stmtsp: [{
      type: "IF",
      condp: [{ type: "EQ", lhsp: [read("rst_an_i")], rhsp: [value("1'h0")] }],
      thensp: [assign("state_r", value("3'h0"))],
      elsesp: [{
        type: "CASE",
        exprp: [read("state_r")],
        itemsp: [
          {
            type: "CASEITEM",
            condsp: [value("3'h0")],
            stmtsp: [{
              type: "IF", condp: [read("en_i")],
              thensp: [assign("state_r", value("3'h1"))], elsesp: [],
            }],
          },
          { type: "CASEITEM", condsp: [value("3'h1"), value("3'h2")], stmtsp: [assign("state_r", value("3'h3"))] },
          { type: "CASEITEM", condsp: [], stmtsp: [assign("state_r", value("3'h0"))] },
        ],
      }],
    }],
  }],
} as unknown as VerilatorNode;

const nets = new Map([
  ["state_r", net("n0", "state_r")],
  ["clk_i", net("n1", "clk_i", 1)],
  ["rst_an_i", net("n2", "rst_an_i", 1)],
  ["en_i", net("n3", "en_i", 1)],
]);
const graph = lowerAlways(dump, fsm, nets, new IdMint());
const flop = graph.cells.find((c) => c.pins.Q?.net === "n0") as Primitive;
const driver = (netId: string | undefined): Primitive | undefined =>
  graph.cells.find((c) => c.pins.Y?.net === netId);

describe("a register assigned across the branches of a case", () => {
  it("keeps the reset branch on the flip-flop, not in the data path", () => {
    expect(flop).toBeDefined();
    expect(flop.kind).toBe("adff");
    expect(flop.params?.RST_VAL).toBe("0");
    expect(flop.pins.ARST?.net).toBe("n2");
    // the branch conditions are the mux tree now, not one enable
    expect(flop.pins.EN).toBeUndefined();
  });

  it("drives D from a mux tree rather than one of the branches", () => {
    expect(driver(flop.pins.D?.net)?.kind).toBe("mux");
    expect(graph.cells.filter((c) => c.kind === "mux").length).toBeGreaterThanOrEqual(3);
  });

  it("selects on the state, one comparison per case item", () => {
    const compares = graph.cells.filter((c) => c.kind === "eq" && c.pins.A?.net === "n0");
    const matched = compares.map((c) => driver(c.pins.B?.net)?.params?.value);
    expect(matched).toEqual(["0", "1", "2"]);
    // `1, 2:` is one branch taken on either value
    expect(graph.cells.some((c) => c.kind === "or")).toBe(true);
  });

  it("holds the register where a branch assigns nothing", () => {
    // the case item for state 0 only assigns under en_i, so the other way round
    // the register keeps what it had: its own output, back into a mux
    expect(graph.cells.some((c) => c.kind === "mux"
      && (c.pins.A?.net === "n0" || c.pins.B?.net === "n0"))).toBe(true);
  });

  it("reads back as the conditional it was written as", () => {
    const named = (id: string): string | undefined => [...nets.values()].find((n) => n.id === id)?.name;
    const text = prettyNet(flop.pins.D?.net ?? "", graph, named);
    expect(text).toContain("state_r == 0");
    expect(text).toContain("en_i ?");
    // the held value is the register's name, not the flip-flop that drives it
    expect(text).toContain("state_r");
    expect(text).not.toContain("adff");
  });
});
