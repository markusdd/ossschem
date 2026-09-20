import { viewIdKey, type Design, type Instance, type Module } from "@ossschem/ir";
import type { Level0Kind } from "./level0.js";
import type { ViewSession } from "./session.js";
import { copySession, flattenNodes } from "./visible.js";
import { buildLevel0Connectivity } from "./connect.js";

export type ExpansionMode = "structure" | "logic";

export function moduleRootKey(session: ViewSession): string {
  return viewIdKey({ path: session.path, irId: session.moduleId });
}

export interface HierarchyItem {
  key: string;
  title: string;
  kind: Level0Kind;
  detail?: string;
  ancestors: { key: string; kind: "instance" | "instanceArray" }[];
  children: HierarchyItem[];
}

/** Structural hierarchy is independent of what is expanded or isolated on the canvas. */
export function buildHierarchy(design: Design, session: ViewSession): HierarchyItem[] {
  const moduleItems = (mod: Module, path: string[], ancestors: HierarchyItem["ancestors"], seen: Set<string>): HierarchyItem[] => {
    if (seen.has(mod.id)) return [];
    const visited = new Set([...seen, mod.id]);
    const keyFor = (irId: string): string => viewIdKey({ path, irId });
    const instanceItem = (inst: Instance, parents: HierarchyItem["ancestors"]): HierarchyItem => {
      const key = keyFor(inst.id);
      const child = design.modules[inst.module];
      return { key, kind: "instance", title: `${inst.name}${inst.arrayIndex === undefined ? "" : `[${inst.arrayIndex}]`}`,
        detail: child?.name, ancestors: parents,
        children: child ? moduleItems(child, [...path, ...inst.relPath], [...parents, { key, kind: "instance" }], visited) : [] };
    };
    const arrays = mod.instances.filter(i => i.kind === "instanceArray");
    const members = new Set(arrays.flatMap(a => a.members));
    return [
      // Nested module ports are represented by their instance boundary pins on the canvas.
      ...(ancestors.length === 0 ? mod.ports.map(p => ({ key: keyFor(p.id), title: p.name, kind: "port" as const, detail: p.dir, ancestors, children: [] })) : []),
      ...mod.boxes.map(b => ({ key: keyFor(b.id), title: b.name, kind: b.kind, detail: b.kind, ancestors, children: [] })),
      ...arrays.map(a => {
        const key = keyFor(a.id);
        const parents = [...ancestors, { key, kind: "instanceArray" as const }];
        return { key, title: `${a.name} [${a.range.msb}:${a.range.lsb}]`, kind: "instanceArray" as const, detail: design.modules[a.module]?.name,
          ancestors, children: mod.instances.filter((i): i is Instance => i.kind === "instance" && a.members.includes(i.id)).map(i => instanceItem(i, parents)) };
      }),
      ...mod.instances.filter((i): i is Instance => i.kind === "instance" && !members.has(i.id)).map(i => instanceItem(i, ancestors)),
    ];
  };
  const mod = design.modules[session.moduleId];
  return mod ? moduleItems(mod, session.path, [], new Set()) : [];
}

export function flattenHierarchy(items: HierarchyItem[]): HierarchyItem[] {
  return items.flatMap(item => [item, ...flattenHierarchy(item.children)]);
}

/** Make the selected structural occurrence available before an explicit canvas action. */
export function prepareHierarchySelection(session: ViewSession, item: HierarchyItem): ViewSession {
  const next = copySession(session);
  item.ancestors.forEach((ancestor, index) => {
    (ancestor.kind === "instanceArray" ? next.exploded : next.expansion).add(ancestor.key);
    next.partial?.get(ancestor.key)?.add(item.ancestors[index + 1]?.key ?? item.key);
  });
  next.visible?.add(item.key);
  return next;
}

/** Additively open an entire structural subtree, optionally including process logic. */
export function expandHierarchy(design: Design, session: ViewSession, key: string, mode: ExpansionMode): ViewSession {
  const hierarchy = buildHierarchy(design, session);
  const root = key === moduleRootKey(session);
  const item = flattenHierarchy(hierarchy).find(n => n.key === key);
  if (!root && !item) return copySession(session);
  const next = item ? prepareHierarchySelection(session, item) : copySession(session);
  const items = flattenHierarchy(item ? [item] : hierarchy);
  for (const child of items) {
    if (child.kind === "instanceArray") {
      next.exploded.add(child.key);
      const parent = [...child.ancestors].reverse().find(a => a.kind === "instance");
      const partial = parent && next.partial?.get(parent.key);
      child.children.forEach(member => partial?.add(member.key));
    }
    else if (child.kind === "instance" || (mode === "logic" && ["always", "assign"].includes(child.kind))) {
      next.expansion.add(child.key);
      next.partial?.delete(child.key);
    }
  }
  if (root) {
    next.visible = undefined;
    next.hiddenEdges?.clear();
  }
  else if (next.visible || next.hiddenEdges?.size) {
    const scope = new Set(items.map(n => n.key));
    for (const node of flattenNodes(buildLevel0Connectivity(design, undefined, next).nodes)) {
      if (scope.has(node.key)) flattenNodes([node]).forEach(n => {
        next.visible?.add(n.key);
        n.interiorEdges?.forEach(e => next.hiddenEdges?.delete(e.key));
      });
    }
  }
  return next;
}
