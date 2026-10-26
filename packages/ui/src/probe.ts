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
  /** The dumps the host can read and the one it is using. Returns an unsubscribe. */
  onWaveformsChanged?(cb: (state: WaveformChoice) => void): () => void;
  /** Work against this dump from now on. */
  useWaveform?(uri: string): void;
  /** Where the design sits in the dump in use; undefined forgets it, so it is found again. */
  useScope?(scope: string[] | undefined, source: ScopeSource): void;
  /** A signal the user picked out in the waveform viewer, by its dump name. Returns an unsubscribe. */
  onDumpSignal?(cb: (dumpPath: string[]) => void): () => void;
  /** Say something where the user is looking. */
  notify?(message: string, level: "info" | "warning"): void;
}

/** Found from the dump's own names, or given by the user -- which is never second-guessed. */
export type ScopeSource = "auto" | "manual";

export interface WaveformChoice {
  documents: { uri: string; label: string }[];
  /** Undefined until the host has one open. */
  active?: string;
  /** The dump's name for the design's top instance in the active dump, once known. */
  scope?: string[];
  scopeSource?: ScopeSource;
}

export const NullProbeProvider: ProbeProvider = {
  resolve: () => null,
};
