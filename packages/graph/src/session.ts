import type { Design } from "@ossschem/ir";

export const DEFAULT_FANOUT_LIMIT = 8;

export interface ViewSession {
  moduleId: string;
  path: string[];
  exploded: Set<string>;
  expansion: Set<string>;
  /** Hide module nets with this many loads or more by default; zero disables the limit. */
  fanoutLimit?: number;
  /** Undefined displays the complete module; otherwise retain these nodes and their ancestors. */
  visible?: Set<string>;
  revealedEdges?: Set<string>;
  /** Explicitly collapsed wire branches; tracing a branch removes its override. */
  hiddenEdges?: Set<string>;
  /** Direct children exposed by signal tracing, independent of module isolation. */
  partial?: Map<string, Set<string>>;
}

export function defaultSession(design: Design): ViewSession {
  const top = design.modules[design.top];
  return {
    moduleId: design.top,
    path: [top.name],
    exploded: new Set(),
    expansion: new Set(),
  };
}

export function sessionKey(s: ViewSession): string {
  return `${s.moduleId}|${s.path.join("/")}|${s.fanoutLimit ?? DEFAULT_FANOUT_LIMIT}|${[...s.exploded].sort().join(",")}|${[...s.expansion].sort().join(",")}|${s.visible ? [...s.visible].sort().join(",") : "all"}|${[...(s.revealedEdges ?? [])].sort().join(",")}|${[...(s.hiddenEdges ?? [])].sort().join(",")}|${JSON.stringify([...(s.partial ?? [])].sort(([a], [b]) => a.localeCompare(b)).map(([key, children]) => [key, [...children].sort()]))}`;
}

/** Resolve the module occurrence owning a visible node or process primitive. */
export function moduleAtKey(design: Design, session: ViewSession, key: string): { moduleId: string; path: string[] } {
  const target = key.slice(0, key.lastIndexOf("#")).split("/");
  let moduleId = session.moduleId;
  let path = session.path;
  while (path.length < target.length) {
    const inst = design.modules[moduleId]?.instances.find(i => i.kind === "instance" &&
      i.relPath.length > 0 && i.relPath.every((part, index) => target[path.length + index] === part));
    if (inst?.kind !== "instance") break;
    path = [...path, ...inst.relPath];
    moduleId = inst.module;
  }
  return { moduleId, path };
}
