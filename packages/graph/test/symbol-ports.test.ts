import { describe, expect, it } from "vitest";
import { placeGatePins, mapSymbolPoint } from "../src/symbol-ports.js";
import type { Level0Node } from "../src/level0.js";

describe("flip-flop pin placement", () => {
  for (const kind of ["dff", "adff", "dffe", "adffe"]) {
    it(`${kind}: clock at lower left, reset above data and enable`, () => {
      const names = ["D", "CLK", "Q", ...(kind.startsWith("a") ? ["ARST"] : []), ...(kind.endsWith("e") ? ["EN"] : [])];
      const node: Level0Node = {
        key: "ff", id: { path: [], irId: "ff" }, kind: "primitive", symbol: kind,
        title: "", x: 0, y: 0, w: 168, h: 144,
        pins: names.map(name => ({ id: name, name, netId: name, netName: name, side: name === "Q" ? "E" : "W" })),
      };
      const pins = Object.fromEntries(placeGatePins(node).map(p => [p.name, p]));
      expect(pins.CLK.y).toBeGreaterThan(pins.D.y!);
      expect(pins.CLK).toMatchObject(mapSymbolPoint(18, 52, node.w, node.h));
      expect(pins.Q.y).toBe(pins.D.y);
      const inputs = Object.values(pins).filter(p => p.side === "W").sort((a, b) => a.y! - b.y!);
      expect(new Set(inputs.map(p => p.x)).size).toBe(1);
      const pitch = inputs[1].y! - inputs[0].y!;
      for (let i = 2; i < inputs.length; i++) expect(inputs[i].y! - inputs[i - 1].y!).toBeCloseTo(pitch);
      if (pins.ARST) expect(pins.ARST.y).toBeLessThan(pins.D.y!);
      if (pins.EN) {
        expect(pins.EN.y).toBeGreaterThan(pins.D.y!);
        expect(pins.EN.y).toBeLessThan(pins.CLK.y!);
      }
    });
  }
});
