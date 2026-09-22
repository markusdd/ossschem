import type { HierPath, Id } from "@ossschem/ir";

export interface HierRef {
  path: HierPath;
  net: Id;
}

export interface ProbeProvider {
  resolve(path: string | string[]): HierRef | null;
  /** One gesture can mean several signals: an array is all of its elements. */
  onNetPicked?(refs: HierRef[]): void;
  /** The host asking the schematic to show a signal it names. Returns an unsubscribe. */
  onRevealRequest?(cb: (instancePath: string[]) => void): () => void;
  /** Values at the cursor for the named signals, keyed by the joined path. */
  values?(paths: string[][]): Promise<Record<string, string | string[]>>;
  /** The cursor moved in the waveform viewer. Returns an unsubscribe. */
  onCursorMoved?(cb: () => void): () => void;
}

export const NullProbeProvider: ProbeProvider = {
  resolve: () => null,
};
