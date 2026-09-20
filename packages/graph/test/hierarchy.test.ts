import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Design } from "@ossschem/ir";
import {
  buildHierarchy, buildVisibleConnectivity, defaultSession, expandComponent, flattenHierarchy,
  flattenNodes, isolateComponent, prepareHierarchySelection,
  expandHierarchy, moduleRootKey, sessionKey,
} from "../src/index.js";

const design = JSON.parse(readFileSync(new URL("../../../fixtures/svb_afifo/golden/schematic-ir.json", import.meta.url), "utf8")) as Design;

it("preserves arrays, member instances, and child-module processes before canvas expansion", () => {
  const session = defaultSession(design);
  const hierarchy = buildHierarchy(design, session);
  const array = hierarchy.find(n => n.kind === "instanceArray")!;
  expect(array.children.length).toBeGreaterThan(1);
  expect(array.children.every(n => n.kind === "instance")).toBe(true);
  expect(array.children[0].children.some(n => n.kind === "always")).toBe(true);
  expect(session.expansion.size).toBe(0);
  expect(session.exploded.size).toBe(0);
  const items = flattenHierarchy(hierarchy);
  expect(new Set(items.map(n => n.key)).size).toBe(items.length);
  expect(items.some(n => n.kind === "primitive")).toBe(false);
});

it("expands structure from the module root without opening process logic", () => {
  const session = defaultSession(design);
  const expanded = expandHierarchy(design, session, moduleRootKey(session), "structure");
  const nodes = flattenNodes(buildVisibleConnectivity(design, expanded).nodes);
  expect(nodes.some(n => n.kind === "instanceArray")).toBe(false);
  expect(nodes.filter(n => n.kind === "instance")).toHaveLength(10);
  expect(nodes.filter(n => n.kind === "instance").every(n => n.children!.length > 0)).toBe(true);
  expect(nodes.filter(n => n.kind === "always").length).toBeGreaterThan(7);
  expect(nodes.some(n => n.kind === "primitive")).toBe(false);
  expect(sessionKey(expandHierarchy(design, expanded, moduleRootKey(session), "structure"))).toBe(sessionKey(expanded));
  expect(session.expansion.size).toBe(0);
});

it("expands all logic from the module root and never toggles it closed", () => {
  const session = defaultSession(design);
  const expanded = expandHierarchy(design, session, moduleRootKey(session), "logic");
  const nodes = flattenNodes(buildVisibleConnectivity(design, expanded).nodes);
  expect(nodes.filter(n => n.kind === "always")).toHaveLength(17);
  expect(nodes.filter(n => ["always", "assign", "instance"].includes(n.kind)).every(n => n.children!.length > 0)).toBe(true);
  expect(nodes.some(n => n.kind === "primitive")).toBe(true);
  expect(sessionKey(expandHierarchy(design, expanded, moduleRootKey(session), "logic"))).toBe(sessionKey(expanded));
  expect(sessionKey(expandHierarchy(design, expanded, moduleRootKey(session), "structure"))).toBe(sessionKey(expanded));
});

it("expands just a selected instance's logic, including from an isolated subtree", () => {
  const session = defaultSession(design);
  const instance = flattenHierarchy(buildHierarchy(design, session)).find(n => n.kind === "instance")!;
  const prepared = prepareHierarchySelection(session, instance);
  const isolated = isolateComponent(design, prepared, instance.key);
  const expanded = expandHierarchy(design, isolated, instance.key, "logic");
  const graph = buildVisibleConnectivity(design, expanded);
  expect(graph.nodes.map(n => n.key)).toEqual([instance.key]);
  expect(graph.nodes[0].children!.filter(n => n.kind === "always").every(n => n.children!.length > 0)).toBe(true);
  const originalKeys = new Set(instance.children.map(n => n.key));
  expect([...expanded.expansion].every(key => key === instance.key || originalKeys.has(key))).toBe(true);
});

it("isolates or expands a process selected beneath a previously closed subinstance", () => {
  const session = defaultSession(design);
  const process = flattenHierarchy(buildHierarchy(design, session)).find(n => n.kind === "always" && n.ancestors.length > 0)!;
  const prepared = prepareHierarchySelection(session, process);
  expect(prepared.exploded.size).toBeGreaterThan(0);
  expect(prepared.expansion.size).toBeGreaterThan(0);
  const isolated = isolateComponent(design, prepared, process.key);
  const shown = flattenNodes(buildVisibleConnectivity(design, isolated).nodes);
  expect(shown.some(n => n.key === process.key)).toBe(true);
  expect(shown.every(n => n.key === process.key || process.ancestors.some(a => a.key === n.key))).toBe(true);
  const expanded = expandComponent(design, prepared, process.key, true);
  const component = flattenNodes(buildVisibleConnectivity(design, expanded).nodes).find(n => n.key === process.key)!;
  expect(component.children!.length).toBeGreaterThan(0);
});
