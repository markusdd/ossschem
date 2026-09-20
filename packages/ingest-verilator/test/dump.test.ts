import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLoc, parseVerilatorDump, walkNodes, widthFromRange } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const tree = JSON.parse(
  readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.tree.json"), "utf8"),
) as unknown;
const meta = JSON.parse(
  readFileSync(resolve(root, "fixtures/svb_afifo/verilator/svb_afifo.meta.json"), "utf8"),
) as unknown;

describe("parseLoc", () => {
  it("parses fileid, lines, exclusive endCol", () => {
    expect(parseLoc("f,32:16,32:22")).toEqual({
      fileId: "f",
      firstLine: 32,
      firstCol: 16,
      lastLine: 32,
      endCol: 22,
    });
  });

  it("accepts multi-character file ids", () => {
    expect(parseLoc("aa,1:0,1:1").fileId).toBe("aa");
  });

  it("rejects garbage", () => {
    expect(() => parseLoc("nope")).toThrow(/invalid Verilator loc/);
  });
});

describe("widthFromRange", () => {
  it("maps missing range and 0:0 to 1-bit", () => {
    expect(widthFromRange(undefined)).toEqual({ msb: 0, lsb: 0, packed: true });
    expect(widthFromRange("0:0")).toEqual({ msb: 0, lsb: 0, packed: true });
  });

  it("parses msb:lsb", () => {
    expect(widthFromRange("4:0")).toEqual({ msb: 4, lsb: 0, packed: true });
  });
});

describe("parseVerilatorDump(svb_afifo)", () => {
  const dump = parseVerilatorDump(tree, meta);

  it("indexes every addr (433 on this fixture)", () => {
    expect(dump.byAddr.size).toBe(433);
  });

  it("resolves full_o loc to svb_afifo.sv line 32", () => {
    let fullO: (typeof dump.tree) | undefined;
    walkNodes(dump.tree, (node) => {
      if (node.type === "VAR" && node.name === "full_o") {
        fullO = node;
      }
    });
    expect(fullO).toBeDefined();
    const loc = dump.loc(fullO);
    expect(loc?.basename).toBe("svb_afifo.sv");
    expect(loc?.firstLine).toBe(32);
    expect(loc?.firstCol).toBe(16);
    expect(loc?.endCol).toBe(22);
  });

  it("resolves dtype (LB) as [4:0]", () => {
    const dtype = dump.dtype("(LB)");
    expect(dtype?.kind).toBe("basic");
    expect(dtype?.keyword).toBe("logic");
    expect(dtype?.width).toEqual({ msb: 4, lsb: 0, packed: true });
  });

  it("resolves scalar (N) and 0:0 (HP) as 1-bit", () => {
    expect(dump.dtype("(N)")?.width).toEqual({ msb: 0, lsb: 0, packed: true });
    expect(dump.dtype("(HP)")?.width).toEqual({ msb: 0, lsb: 0, packed: true });
  });

  it("resolves CELL.modp of a sync instance to MODULE svb_sync", () => {
    let cell: (typeof dump.tree) | undefined;
    walkNodes(dump.tree, (node) => {
      if (node.type === "CELL" && node.name === "u_svb_sync_gray_wpointer" && cell === undefined) {
        cell = node;
      }
    });
    expect(cell).toBeDefined();
    const mod = dump.resolve(typeof cell?.modp === "string" ? cell.modp : undefined);
    expect(mod?.type).toBe("MODULE");
    expect(mod?.name).toBe("svb_sync");
  });

  it("has zero dangling varp/modp/dtypep/refDTypep/modVarp", () => {
    expect(dump.dangling()).toEqual([]);
  });

  it("treats UNLINKED varScopep as not dangling", () => {
    expect(dump.dangling(["varScopep"])).toEqual([]);
  });
});
