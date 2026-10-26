import { useCallback, useEffect, useMemo, useState } from "react";
import { fromDumpPath, inferDumpScope, likelyDumpScopes, resolveProbePath, scopeWitnesses, toDumpPath } from "@ossschem/graph";
import type { Design } from "@ossschem/ir";
import type { ProbeProvider, ScopeSource, WaveformChoice } from "./probe.js";

/* The schematic names signals from its own top; a dump written around it may
 * not (see @ossschem/graph's dump-scope). What is here sits between the
 * schematic and the host, so neither has to know: the schematic keeps its own
 * names, the host sees only the dump's.
 *
 * The scope itself is the host's to keep, per dump and design, so it outlives
 * the panel. It is found three ways, each confirmed against the dump before it
 * is kept (see scopeWitnesses), and one the user gave is never replaced:
 * - when a dump comes into use, by asking it for the top's ports under the
 *   likely scopes -- the design's own names, then Verilator's TOP;
 * - from any signal the user picks out in the waveform viewer, while nothing
 *   is known yet;
 * - from a signal revealed in the schematic that the scope in use does not
 *   cover, unless the user set that scope.
 */

/* Whether the dump holds the design under a scope: every witness answers. A
 * design with nothing to check is taken at its word. */
export async function confirmScope(host: ProbeProvider, design: Design, scope: string[]): Promise<boolean> {
  const witnesses = scopeWitnesses(design);
  if (witnesses.length === 0 || host.values === undefined) {
    return witnesses.length === 0;
  }
  const answered = await host.values(witnesses.map((path) => toDumpPath(path, scope)));
  return witnesses.every((path) => answered[toDumpPath(path, scope).join(".")] !== undefined);
}

/** The first likely scope the dump confirms, before anything has been learned. */
export async function findLikelyScope(host: ProbeProvider, design: Design): Promise<string[] | undefined> {
  for (const candidate of likelyDumpScopes(design)) {
    if (await confirmScope(host, design, candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** The scope one dump signal points to, once the dump confirms it. */
export async function learnScope(host: ProbeProvider, design: Design, dumpPath: string[]): Promise<string[] | null> {
  const inferred = inferDumpScope(design, dumpPath);
  return inferred !== null && await confirmScope(host, design, inferred) ? inferred : null;
}

/* The host's probe, speaking the schematic's names under one scope: names
 * going out are the dump's, names coming in are the schematic's. A revealed
 * signal the scope does not cover may teach a better one, unless the user set
 * this one; otherwise the user is told why nothing happened. */
export function scopedProbe(host: ProbeProvider, design: Design, scope: string[], source?: ScopeSource): ProbeProvider {
  const topName = design.modules[design.top]?.name;
  if (topName === undefined) {
    return host;
  }
  const outward = (path: string[]): string[] => toDumpPath(path, scope);
  return {
    ...host,
    onNetPicked: host.onNetPicked === undefined ? undefined : (refs) => {
      host.onNetPicked?.(refs.map((ref) => ({ ...ref, path: outward(ref.path) })));
    },
    values: host.values === undefined ? undefined : async (paths) => {
      const answered = await host.values!(paths.map(outward));
      // keyed back by the schematic's names, which is what was asked for
      const values: Record<string, string | string[]> = {};
      for (const path of paths) {
        const value = answered[outward(path).join(".")];
        if (value !== undefined) {
          values[path.join(".")] = value;
        }
      }
      return values;
    },
    onRevealRequest: host.onRevealRequest === undefined ? undefined : (cb) => host.onRevealRequest!(async (dumpPath) => {
      const local = fromDumpPath(dumpPath, scope, topName);
      if (local !== null && resolveProbePath(design, local) !== null) {
        cb(local);
        return;
      }
      const learned = source === "manual" ? null : await learnScope(host, design, dumpPath);
      if (learned !== null) {
        host.useScope?.(learned, "auto");
        host.notify?.(`${topName} is ${learned.join(".")} in this waveform; signals are matched from there now.`, "info");
        cb(fromDumpPath(dumpPath, learned, topName) ?? []);
        return;
      }
      host.notify?.(local === null
        ? `${dumpPath.join(".")} is outside ${topName}, which is ${scope.join(".")} in this waveform.`
          + " Set the design's scope in the schematic's sidebar, or with Use as ossschem design root in the netlist view."
        : `${dumpPath.join(".")} is in ${topName}, but the schematic has no signal of that name.`, "warning");
    }),
  };
}

export interface DumpScope {
  /** The host's probe, speaking the schematic's names: everything crossing it is translated. */
  probe: ProbeProvider;
  /** The dump's name for the design's top instance, as used right now. */
  scope: string[];
  /** How the scope in use was settled; undefined while nothing is known and the design's own names stand in. */
  source?: ScopeSource;
  /** Whether the dump confirms that scope; undefined until asked. */
  found?: boolean;
  /** The user's word on the scope; undefined hands it back to detection. */
  setScope(scope: string[] | undefined): void;
}

export function useDumpScope(host: ProbeProvider, design: Design | null): DumpScope {
  const [choice, setChoice] = useState<WaveformChoice>({ documents: [] });
  useEffect(() => host.onWaveformsChanged?.(setChoice), [host]);
  const [found, setFound] = useState<boolean | undefined>(undefined);

  const topName = design?.modules[design.top]?.name;
  const known = choice.scope !== undefined && choice.scope.length > 0 ? choice.scope : undefined;
  const scopeText = (known ?? (topName === undefined ? [] : [topName])).join(".");
  const scope = useMemo(() => (scopeText === "" ? [] : scopeText.split(".")), [scopeText]);
  const source = known === undefined ? undefined : choice.scopeSource;
  const active = choice.active;
  const placed = known !== undefined;

  const probe = useMemo(
    () => (design === null ? host : scopedProbe(host, design, scope, source)),
    [host, design, scope, source],
  );

  // nothing known yet: try the likely scopes, and keep the first the dump confirms
  useEffect(() => {
    if (design === null || active === undefined || placed || host.useScope === undefined) {
      return;
    }
    let dropped = false;
    void findLikelyScope(host, design).then((likely) => {
      if (likely !== undefined && !dropped) {
        host.useScope?.(likely, "auto");
      }
    });
    return () => { dropped = true; };
  }, [host, design, active, placed]);

  // still nothing known: any signal picked out in the waveform may say where the design is
  useEffect(() => {
    if (design === null || placed || host.onDumpSignal === undefined) {
      return;
    }
    let dropped = false;
    const unsubscribe = host.onDumpSignal((dumpPath) => {
      void learnScope(host, design, dumpPath).then((learned) => {
        if (learned !== null && !dropped) {
          host.useScope?.(learned, "auto");
        }
      });
    });
    return () => {
      dropped = true;
      unsubscribe();
    };
  }, [host, design, placed]);

  // whether the scope in use holds the design, for the sidebar to say
  useEffect(() => {
    setFound(undefined);
    if (design === null || active === undefined || host.values === undefined || scopeWitnesses(design).length === 0) {
      return;
    }
    let dropped = false;
    void confirmScope(host, design, scope).then((holds) => {
      if (!dropped) {
        setFound(holds);
      }
    });
    return () => { dropped = true; };
  }, [host, design, active, scope]);

  const setScope = useCallback((next: string[] | undefined) => {
    host.useScope?.(next, "manual");
  }, [host]);

  return { probe, scope, source, found, setScope };
}
