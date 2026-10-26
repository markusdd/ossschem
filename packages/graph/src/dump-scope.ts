import type { Design } from "@ossschem/ir";
import { resolveProbePath } from "./select.js";

/* Where the design sits in a waveform dump.
 *
 * The schematic names a signal from its own top down: `top.sub.sig`. A dump
 * written around it names the same signal from the simulation's top, which may
 * be a testbench the schematic cannot show -- a SystemC or C++ harness, a
 * cocotb wrapper, or just Verilator's `TOP` -- and may call the design's top
 * instance something else: `TOP.tb.u_dut.sub.sig`. The scope is the dump's
 * full name for the design's top instance, `TOP.tb.u_dut` there, and swapping
 * it for the top's own name is all it takes to go from one to the other.
 *
 * With no scope known, the design's top name stands in for it: the dump is
 * taken to name things the way the schematic does.
 */

/** The dump's name for a signal the schematic names `path`. */
export function toDumpPath(path: readonly string[], scope: readonly string[]): string[] {
  return [...scope, ...path.slice(1)];
}

/** The schematic's name for a dump signal, or null when it lies outside the design. */
export function fromDumpPath(path: readonly string[], scope: readonly string[], topName: string): string[] | null {
  if (path.length <= scope.length || !scope.every((part, i) => path[i] === part)) {
    return null;
  }
  return [topName, ...path.slice(scope.length)];
}

/** A dump's dotted name in segments: `a.b.mem.[3]` -> a, b, mem, [3]. */
export function splitDumpPath(path: string): string[] {
  return path.split(".").filter((part) => part.length > 0);
}

/* The scope a dump signal says the design sits at: the shortest prefix whose
 * remainder names a signal of the design. Shortest, because the longer the
 * remainder that resolves, the more of it has been checked against the design
 * -- `TOP.tb.dut.sub.x` resolving as `sub.x` is better evidence than as a net
 * `x` that the top happens to have as well.
 *
 * Null when no remainder names a signal: the signal belongs to the testbench,
 * or to another design.
 */
export function inferDumpScope(design: Design, dumpPath: readonly string[]): string[] | null {
  const top = design.modules[design.top];
  if (top === undefined) {
    return null;
  }
  for (let k = 1; k < dumpPath.length; k++) {
    if (resolveProbePath(design, [top.name, ...dumpPath.slice(k)]) !== null) {
      return dumpPath.slice(0, k);
    }
  }
  return null;
}

/* Scopes worth trying before anything has been learned: the dump names things
 * as the schematic does, or it is Verilator's own trace, which puts `TOP`
 * above the top instance. */
export function likelyDumpScopes(design: Design): string[][] {
  const top = design.modules[design.top];
  return top === undefined ? [] : [[top.name], ["TOP", top.name]];
}

/* Signals that tell whether a scope is right, under the schematic's own names:
 * a few of the top's ports, which any dump of the design has, and a port of one
 * instance inside it. The ports alone are not enough -- a testbench commonly
 * declares wires named after the ports it connects, so its own scope would
 * pass -- but it does not have the design's instances. A scope counts only
 * when every one of these answers. */
export function scopeWitnesses(design: Design, count = 3): string[][] {
  const top = design.modules[design.top];
  if (top === undefined) {
    return [];
  }
  const witnesses = top.ports.slice(0, count).map((port) => [top.name, port.name]);
  for (const instance of top.instances) {
    const port = instance.kind === "instance" ? design.modules[instance.module]?.ports[0] : undefined;
    if (instance.kind === "instance" && port !== undefined) {
      witnesses.push([top.name, ...instance.relPath, port.name]);
      break;
    }
  }
  return witnesses;
}
