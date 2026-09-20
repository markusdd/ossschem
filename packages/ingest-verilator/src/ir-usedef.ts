import type { Module } from "@ossschem/ir";

export function attachPortAndInstanceEndpoints(ir: Module, modules: Record<string, Module>): void {
  const nets = new Map(ir.nets.map((n) => [n.id, n]));

  for (const port of ir.ports) {
    const net = nets.get(port.net);
    if (net === undefined) {
      continue;
    }
    const ep = { kind: "port" as const, port: port.id, pin: port.name };
    if (port.dir === "input" || port.dir === "inout") {
      net.drivers.push(ep);
    }
    if (port.dir === "output" || port.dir === "inout") {
      net.loads.push(ep);
    }
  }

  for (const inst of ir.instances) {
    if (inst.kind !== "instance") {
      continue;
    }
    const child = modules[inst.module];
    if (child === undefined) {
      continue;
    }
    const childPorts = new Map(child.ports.map((p) => [p.name, p]));
    for (const pin of inst.pins) {
      const net = nets.get(pin.net);
      const childPort = childPorts.get(pin.port);
      if (net === undefined || childPort === undefined) {
        continue;
      }
      const ep = { kind: "box" as const, box: inst.id, pin: pin.port, bits: pin.bits };
      if (childPort.dir === "output") {
        net.drivers.push(ep);
      } else {
        net.loads.push(ep);
      }
    }
  }
}
