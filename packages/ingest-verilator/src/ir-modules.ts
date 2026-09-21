import type { Design, Module, Net, Param, Port, Width } from "@ossschem/ir";
import { parseVerilogInt, constName } from "./const.js";
import { IdMint } from "./ids.js";
import { ingestBoxes } from "./ir-boxes.js";
import { ingestInstances } from "./ir-instances.js";
import { attachPortAndInstanceEndpoints } from "./ir-usedef.js";
import type { VerilatorDump } from "./parse.js";
import { nodeSpan } from "./span.js";
import type { VerilatorNode } from "./types.js";
import { walkNodes } from "./walk.js";

export interface IngestOptions {
  verilatorVersion: string;
  dumpedAt?: string;
  topName?: string;
}

/* A port is declared by its direction, not by varType. Verilator reports
 * `output logic y` as varType PORT but `input wire logic x` as varType WIRE,
 * so keying on varType keeps the outputs and silently drops every input. */
function isPortDirection(raw: unknown): boolean {
  return raw === "INPUT" || raw === "OUTPUT" || raw === "INOUT";
}

function portDir(raw: unknown): Port["dir"] {
  if (raw === "OUTPUT") {
    return "output";
  }
  if (raw === "INOUT") {
    return "inout";
  }
  return "input";
}

function moduleStatements(mod: VerilatorNode): VerilatorNode[] {
  return Array.isArray(mod.stmtsp) ? mod.stmtsp.filter((s) => typeof s === "object" && s !== null) as VerilatorNode[] : [];
}

/** Names written by ASSIGNDLY (sequential). Used to classify `kind: "reg"`. */
function sequentialWriters(mod: VerilatorNode): Set<string> {
  const names = new Set<string>();
  walkNodes(mod, (node) => {
    if (node.type !== "ASSIGNDLY") {
      return;
    }
    walkNodes(node, (inner) => {
      if (inner.type === "VARREF" && inner.access === "WR" && typeof inner.name === "string") {
        names.add(inner.name);
      }
    });
  });
  return names;
}

function widthOf(dump: VerilatorDump, dtypep: unknown): Width {
  const dtype = dump.dtype(typeof dtypep === "string" ? dtypep : undefined);
  return dtype?.width ?? { msb: 0, lsb: 0, packed: true };
}

function ingestModule(dump: VerilatorDump, ast: VerilatorNode, mint: IdMint): Module {
  const id = mint.next("m");
  const seq = sequentialWriters(ast);
  const params: Param[] = [];
  const ports: Port[] = [];
  const nets: Net[] = [];

  for (const stmt of moduleStatements(ast)) {
    if (stmt.type !== "VAR") {
      continue;
    }
    const varType = stmt.varType;
    if (varType === "GENVAR") {
      continue;
    }
    const name = typeof stmt.name === "string" ? stmt.name : "";
    const span = nodeSpan(dump, stmt);
    const width = widthOf(dump, stmt.dtypep);

    if (varType === "GPARAM" || varType === "LPARAM") {
      const raw = constName(stmt.valuep) ?? "";
      params.push({ name, value: parseVerilogInt(raw), width, span });
      continue;
    }

    if (isPortDirection(stmt.direction)) {
      const netId = mint.next("n");
      const portId = mint.next("p");
      nets.push({
        id: netId,
        name,
        width,
        kind: "port",
        span,
        drivers: [],
        loads: [],
      });
      ports.push({
        id: portId,
        name,
        dir: portDir(stmt.direction),
        net: netId,
        span,
      });
      continue;
    }

    // an internal signal, however it was declared
    if (varType === "VAR" || varType === "WIRE" || varType === "PORT") {
      const dtype = dump.dtype(typeof stmt.dtypep === "string" ? stmt.dtypep : undefined);
      const netId = mint.next("n");
      let kind: Net["kind"] = "wire";
      let memory: Net["memory"];
      if (dtype?.kind === "unpackArray") {
        kind = "memory";
        const depth = dtype.unpacked !== undefined ? Math.abs(dtype.unpacked.msb - dtype.unpacked.lsb) + 1 : 0;
        memory = { depth, packed: dtype.width };
      } else if (seq.has(name)) {
        kind = "reg";
      }
      nets.push({
        id: netId,
        name,
        width: dtype?.width ?? width,
        kind,
        memory,
        span,
        drivers: [],
        loads: [],
      });
    }
  }

  return {
    id,
    name: ast.name ?? "",
    origName: typeof ast.origName === "string" ? ast.origName : (ast.name ?? ""),
    span: nodeSpan(dump, ast),
    params,
    ports,
    nets,
    boxes: [],
    instances: [],
  };
}

export function ingestToIr(dump: VerilatorDump, options: IngestOptions): Design {
  const mint = new IdMint();
  const modulesp = Array.isArray(dump.tree.modulesp) ? dump.tree.modulesp : [];
  const modules: Record<string, Module> = {};
  const moduleIdByAddr = new Map<string, string>();
  const astByIrId = new Map<string, VerilatorNode>();
  let top: string | undefined;

  for (const raw of modulesp) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const ast = raw as VerilatorNode;
    if (ast.type !== "MODULE" || ast.name === "@CONST-POOL@") {
      continue;
    }
    const mod = ingestModule(dump, ast, mint);
    modules[mod.id] = mod;
    astByIrId.set(mod.id, ast);
    if (typeof ast.addr === "string") {
      moduleIdByAddr.set(ast.addr, mod.id);
    }
    if (top === undefined && (options.topName === undefined || mod.name === options.topName)) {
      top = mod.id;
    }
  }

  if (options.topName !== undefined) {
    const named = Object.values(modules).find((m) => m.name === options.topName);
    if (named !== undefined) {
      top = named.id;
    }
  }

  if (top === undefined) {
    throw new Error("no MODULE found in NETLIST.modulesp");
  }

  for (const [irId, ast] of astByIrId) {
    ingestInstances(dump, ast, modules[irId], moduleIdByAddr, mint);
    ingestBoxes(dump, ast, modules[irId], mint);
    attachPortAndInstanceEndpoints(modules[irId], modules);
  }

  const files: Design["files"] = {};
  for (const [fileId, info] of Object.entries(dump.meta.files)) {
    files[fileId] = { path: info.filename, language: info.language ?? "" };
  }

  return {
    schemaVersion: 1,
    top,
    modules,
    files,
    meta: {
      producer: "verilator-json-only",
      verilatorVersion: options.verilatorVersion,
      dumpedAt: options.dumpedAt ?? new Date(0).toISOString(),
    },
  };
}
