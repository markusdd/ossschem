import { describe, expect, it } from "vitest";
import { MIN_VERILATOR, parseVerilatorVersion, verilatorOlderThan } from "../src/main.js";

describe("the Verilator behind a build", () => {
  it("reads the version out of what --version prints", () => {
    expect(parseVerilatorVersion("Verilator 5.050 2026-07-01 rev v5.050")).toBe("5.050");
    expect(parseVerilatorVersion("Verilator 5.046 devel rev v5.046-12-gabc")).toBe("5.046");
    expect(parseVerilatorVersion("Verilator 6.1.2 2027-01-01")).toBe("6.1.2");
  });

  it("reports nothing rather than a guess when that is not Verilator", () => {
    expect(parseVerilatorVersion("")).toBeUndefined();
    expect(parseVerilatorVersion("bash: verilator: command not found")).toBeUndefined();
  });

  it("compares by number, not by text", () => {
    expect(verilatorOlderThan("5.046")).toBe(false);
    expect(verilatorOlderThan("5.050")).toBe(false);
    expect(verilatorOlderThan("5.100")).toBe(false);
    expect(verilatorOlderThan("6.0")).toBe(false);
    expect(verilatorOlderThan("5.45")).toBe(true);
    expect(verilatorOlderThan("4.228")).toBe(true);
    // "5.100" sorts before "5.046" as text, after it as a version
    expect(verilatorOlderThan("5.100", "5.046")).toBe(false);
    expect(verilatorOlderThan(MIN_VERILATOR)).toBe(false);
  });
});
