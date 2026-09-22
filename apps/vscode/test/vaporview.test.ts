import { describe, expect, it } from "vitest";
import { arrayShape, chooseDocument, documentLabels, openDocuments, parseIndexSpec, pathCandidates } from "../src/vaporview.js";

describe("what vaporview answers", () => {
  it("takes the bare array of URIs that 1.5.4 returns", () => {
    // getAllDocumentUris() maps documents to uri.toString(); there is no wrapper
    expect(openDocuments(["file:///a.fst", "file:///b.fst"])).toEqual(["file:///a.fst", "file:///b.fst"]);
  });

  it("still takes the object shape the API doc describes, the active one first", () => {
    expect(openDocuments({ documents: ["file:///a.fst"], lastActiveDocument: "file:///b.fst" }))
      .toEqual(["file:///b.fst", "file:///a.fst"]);
    expect(openDocuments({ documents: ["file:///a.fst"] })).toEqual(["file:///a.fst"]);
  });

  it("reports nothing rather than a bad URI when no waveform is open", () => {
    for (const answer of [[], undefined, null, {}]) {
      expect(openDocuments(answer)).toEqual([]);
    }
  });
});

describe("choosing between open waveforms", () => {
  const a = "file:///dumps/a.fst";
  const b = "file:///dumps/b.fst";

  it("has nothing to choose with none open, and no question with one", () => {
    expect(chooseDocument([], [])).toBeUndefined();
    expect(chooseDocument([a], [])).toBe(a);
  });

  it("keeps to the one in use, so the target does not move with the focus", () => {
    expect(chooseDocument([a, b], [a], b)).toBe(b);
  });

  it("drops a choice whose waveform has been closed", () => {
    expect(chooseDocument([a, b], [b], "file:///dumps/gone.fst")).toBe(b);
  });

  it("starts from the one on screen, and otherwise from the first listed", () => {
    expect(chooseDocument([a, b], [b])).toBe(b);
    expect(chooseDocument([a, b], [])).toBe(a);
  });
});

describe("naming the open waveforms", () => {
  it("uses the file name", () => {
    expect(documentLabels(["file:///dumps/a.fst"])).toEqual([{ uri: "file:///dumps/a.fst", label: "a.fst" }]);
  });

  it("adds the directory only where the names collide", () => {
    expect(documentLabels(["file:///one/dump.fst", "file:///two/dump.fst", "file:///two/other.fst"])).toEqual([
      { uri: "file:///one/dump.fst", label: "one/dump.fst" },
      { uri: "file:///two/dump.fst", label: "two/dump.fst" },
      { uri: "file:///two/other.fst", label: "other.fst" },
    ]);
  });

  it("reads an escaped path the way it is written", () => {
    expect(documentLabels(["file:///my%20sims/dump.fst"])[0].label).toBe("dump.fst");
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
