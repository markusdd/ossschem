import { describe, expect, it } from "vitest";
import { arrayShape, parseIndexSpec, pathCandidates, pickDocument } from "../src/vaporview.js";

describe("what vaporview answers", () => {
  it("takes the bare array of URIs that 1.5.4 returns", () => {
    // getAllDocumentUris() maps documents to uri.toString(); there is no wrapper
    expect(pickDocument(["file:///a.fst", "file:///b.fst"])).toBe("file:///a.fst");
  });

  it("still takes the object shape the API doc describes", () => {
    expect(pickDocument({ documents: ["file:///a.fst"], lastActiveDocument: "file:///b.fst" })).toBe("file:///b.fst");
    expect(pickDocument({ documents: ["file:///a.fst"] })).toBe("file:///a.fst");
  });

  it("reports nothing rather than a bad URI when no waveform is open", () => {
    expect(pickDocument([])).toBeUndefined();
    expect(pickDocument(undefined)).toBeUndefined();
    expect(pickDocument(null)).toBeUndefined();
    expect(pickDocument({})).toBeUndefined();
  });
});

describe("candidate spellings", () => {
  it("offers the index-only name first, then the forms other readers use", () => {
    // vaporview 1.5.4 calls it tb.wen_s.[0]; gtkwave renders tb.wen_s.wen_s[0]
    expect(pathCandidates(["tb", "wen_s", "[0]"])).toEqual([
      "tb.wen_s.[0]",
      "tb.wen_s.wen_s[0]",
      "tb.wen_s[0]",
    ]);
  });

  it("does not invent spellings for a plain signal", () => {
    expect(pathCandidates(["tb", "clk_s"])).toEqual(["tb.clk_s", "tb"]);
  });

  it("copes with an empty selection", () => {
    expect(pathCandidates([])).toEqual([]);
  });
});

describe("choosing array elements", () => {
  const bundle = [["tb", "wen_s", "[0]"], ["tb", "wen_s", "[1]"], ["tb", "wen_s", "[2]"]];

  it("recognises the elements of one array", () => {
    expect(arrayShape(bundle)).toEqual({ scope: ["tb", "wen_s"], indices: [0, 1, 2] });
  });

  it("leaves anything that is not an array alone", () => {
    expect(arrayShape([["tb", "clk_s"]])).toBeUndefined();
    expect(arrayShape([["tb", "clk_s"], ["tb", "rst_s"]])).toBeUndefined();
    // elements of two different arrays are not one selection
    expect(arrayShape([["tb", "a", "[0]"], ["tb", "b", "[0]"]])).toBeUndefined();
  });

  it("reads an index, a range and a list", () => {
    const all = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(parseIndexSpec("3", all)).toEqual([3]);
    expect(parseIndexSpec("2-5", all)).toEqual([2, 3, 4, 5]);
    expect(parseIndexSpec("0,2,5", all)).toEqual([0, 2, 5]);
    expect(parseIndexSpec("0-2,7", all)).toEqual([0, 1, 2, 7]);
    expect(parseIndexSpec(" 5 - 2 ", all)).toEqual([2, 3, 4, 5]);
  });

  it("keeps only indices the array actually has", () => {
    // a range may be given loosely; an element that does not exist is dropped
    expect(parseIndexSpec("0-99", [3, 4])).toEqual([3, 4]);
    expect(parseIndexSpec("9", [3, 4])).toBeUndefined();
  });

  it("treats text that is not a spec as a filter, not a selection", () => {
    expect(parseIndexSpec("", [0, 1])).toBeUndefined();
    expect(parseIndexSpec("All", [0, 1])).toBeUndefined();
    expect(parseIndexSpec("0-", [0, 1])).toBeUndefined();
  });
});
