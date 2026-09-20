import type { Level0Edge, Level0Node } from "@ossschem/graph";
import { fromElkGraph, toElkGraph, type LaidOut } from "./elk-graph.js";

const DEFAULT_TIMEOUT_MS = 10_000;

async function layoutMainThread(nodes: Level0Node[], edges: Level0Edge[]): Promise<LaidOut> {
  const mod = await import("elkjs/lib/elk.bundled.js");
  const ELK = mod.default;
  const elk = new ELK();
  const graph = toElkGraph(nodes, edges);
  const raw = (await elk.layout(graph)) as import("./elk-graph.js").ElkNode;
  return fromElkGraph(raw, nodes, edges);
}

export async function layoutLevel0(
  nodes: Level0Node[],
  edges: Level0Edge[],
  opts: { timeoutMs?: number } = {},
): Promise<LaidOut> {
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("layout timed out")), ms);
    });
    return await Promise.race([layoutMainThread(nodes, edges), deadline]);
  } catch {
    return fromElkGraph({ id: "root", children: [], edges: [] }, nodes, edges);
  } finally {
    clearTimeout(timer);
  }
}
