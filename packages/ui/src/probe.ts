import type { HierPath, Id } from "@ossschem/ir";

export interface HierRef {
  path: HierPath;
  net: Id;
}

export interface ProbeProvider {
  resolve(path: string | string[]): HierRef | null;
  /** One gesture can mean several signals: an array is all of its elements. */
  onNetPicked?(refs: HierRef[]): void;
  subscribe(
    cb: (time: { value: number; unit: string }, values: Map<string, string>) => void,
  ): () => void;
}

export const NullProbeProvider: ProbeProvider = {
  resolve: () => null,
  subscribe: () => () => {},
};
