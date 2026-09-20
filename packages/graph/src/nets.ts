import type { AssignBox, AlwaysBox, Endpoint, Module, Net } from "@ossschem/ir";

export function findNet(mod: Module, name: string): Net | undefined {
  return mod.nets.find((n) => n.name === name);
}

export function findBox(mod: Module, name: string): AlwaysBox | AssignBox | undefined {
  return mod.boxes.find((b) => b.name === name);
}

export function boxDrivers(mod: Module, netName: string): Endpoint[] {
  return findNet(mod, netName)?.drivers.filter((d) => d.kind === "box") ?? [];
}

export function portDrivers(mod: Module, netName: string): Endpoint[] {
  return findNet(mod, netName)?.drivers.filter((d) => d.kind === "port") ?? [];
}
