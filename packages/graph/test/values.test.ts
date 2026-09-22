import { describe, expect, it } from "vitest";
import { formatSignalValue } from "../src/values.js";

describe("signal values", () => {
  it("writes a single bit the way Verilog does", () => {
    expect(formatSignalValue("1", 1)).toBe("1'b1");
    expect(formatSignalValue("0", 1)).toBe("1'b0");
  });

  it("writes a vector in hex, padded to its width", () => {
    expect(formatSignalValue("00001111", 8)).toBe("8'h0f");
    expect(formatSignalValue("10100011", 8)).toBe("8'ha3");
    expect(formatSignalValue("00101", 5)).toBe("5'h05");
  });

  it("keeps unknown bits in binary, where they are readable", () => {
    expect(formatSignalValue("010x", 4)).toBe("4'b010x");
    expect(formatSignalValue("zzzz", 4)).toBe("4'bzzzz");
  });

  it("shows a pair either side of the cursor as a transition", () => {
    expect(formatSignalValue(["0", "1"], 1)).toBe("1'b0→1");
    // the width and radix are not worth repeating
    expect(formatSignalValue(["00001111", "10100011"], 8)).toBe("8'h0f→a3");
  });

  it("uses the width to tell a transition from a split vector", () => {
    // two entries, one bit wide: the value changed at the cursor
    expect(formatSignalValue(["0", "1"], 1)).toBe("1'b0→1");
    // two entries, two bits wide: the viewer split the vector
    expect(formatSignalValue(["0", "1"], 2)).toBe("2'h1");
    expect(formatSignalValue(["1", "0", "1", "0"], 4)).toBe("4'ha");
  });

  it("leaves a value the viewer already formatted alone", () => {
    expect(formatSignalValue("8'hff", 8)).toBe("8'hff");
  });

  it("has nothing to say about nothing", () => {
    expect(formatSignalValue("", 1)).toBe("");
    expect(formatSignalValue([], 4)).toBe("");
  });

  it("reads the width off the value when the schematic does not know it", () => {
    // an edge carries no width for a plain wire; the bits say how many there are
    expect(formatSignalValue("10100011")).toBe("8'ha3");
    expect(formatSignalValue("1")).toBe("1'b1");
    expect(formatSignalValue(["0", "1"])).toBe("1'b0→1");
    expect(formatSignalValue(["1", "0", "1", "0"])).toBe("4'ha");
  });

  it("believes the value over a width that contradicts it", () => {
    // never claim one bit while showing eight
    expect(formatSignalValue("10100011", 1)).toBe("8'ha3");
    // a trimmed value keeps the declared width
    expect(formatSignalValue("1", 8)).toBe("8'h01");
  });

  it("takes the values out of the wrapper a viewer built around them", () => {
    // exactly what vaporview 1.5.4 returned for a one bit signal: the empty
    // list is "nothing before the cursor"
    expect(formatSignalValue('[],"0"]', 1)).toBe("1'b0");
    expect(formatSignalValue('["0","1"]', 1)).toBe("1'b0→1");
    expect(formatSignalValue('[[],"10100011"]', 8)).toBe("8'ha3");
    expect(formatSignalValue([[], "0"] as unknown as string[], 1)).toBe("1'b0");
  });

  it("never lets a bracket reach the drawing", () => {
    for (const raw of ['[],"0"]', '["0","1"]', "[0]", "[]"]) {
      expect(formatSignalValue(raw, 1)).not.toMatch(/[[\]"]/);
    }
  });
});
