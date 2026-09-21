import { describe, expect, it } from "vitest";
import { pathCandidates, pickDocument } from "../src/vaporview.js";

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
