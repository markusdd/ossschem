/**
 * What vaporview actually answers, as opposed to what its API doc describes.
 *
 * Kept free of the vscode API so the shapes can be exercised directly. The doc
 * for `waveformViewer.getOpenDocuments` describes an object with `documents`
 * and `lastActiveDocument`; 1.5.4 returns a bare array of URI strings. Both
 * are accepted so an upgrade in either direction keeps working.
 */
export type OpenDocuments = string[] | { documents?: string[]; lastActiveDocument?: string } | undefined | null;

export function pickDocument(result: OpenDocuments): string | undefined {
  if (Array.isArray(result)) {
    return result.find((uri) => typeof uri === "string" && uri.length > 0);
  }
  if (result === undefined || result === null) {
    return undefined;
  }
  return result.lastActiveDocument ?? result.documents?.find((uri) => uri.length > 0);
}

/* Spellings a dump might use for one selected signal, most likely first.
 *
 * An unpacked array element is named by index alone in vaporview 1.5.4
 * (`wen_s.[0]`), because the scope carries the array name; other readers
 * repeat the name (`wen_s.wen_s[0]`) or drop the scope (`wen_s[0]`).
 */
export function pathCandidates(path: string[]): string[] {
  if (path.length === 0) {
    return [];
  }
  const leaf = path[path.length - 1];
  const index = /^\[\d+\]$/.test(leaf);
  const array = path.length >= 2 ? path[path.length - 2] : "";
  const spellings = index
    ? [
        path.join("."),
        [...path.slice(0, -1), `${array}${leaf}`].join("."),
        [...path.slice(0, -2), `${array}${leaf}`].join("."),
      ]
    : [path.join("."), path.slice(0, -1).join(".")];
  return spellings.filter((candidate, i, all) => candidate.length > 0 && all.indexOf(candidate) === i);
}

/** Arrays up to this size are added whole without asking. */
export const SMALL_ARRAY = 8;

export interface ArraySelection {
  /** Path of the array itself, without the element. */
  scope: string[];
  indices: number[];
}

/* Whether a pick is the elements of one unpacked array, which is the only
 * case worth asking about: everything else goes straight to the viewer. */
export function arrayShape(paths: string[][]): ArraySelection | undefined {
  if (paths.length < 2) {
    return undefined;
  }
  const scope = paths[0].slice(0, -1);
  const indices: number[] = [];
  for (const path of paths) {
    const leaf = path[path.length - 1];
    const match = /^\[(\d+)\]$/.exec(leaf);
    if (match === null || path.slice(0, -1).join(".") !== scope.join(".")) {
      return undefined;
    }
    indices.push(Number(match[1]));
  }
  return { scope, indices };
}

/* An index, a range, or a list of either: "3", "0-7", "0,2,5", "0-3,8".
 * Indices outside the array are dropped, so a range can be given loosely.
 * Undefined when the text is not a spec at all, which leaves the typed text
 * to be treated as a filter rather than a selection. */
export function parseIndexSpec(spec: string, available: number[]): number[] | undefined {
  const text = spec.trim();
  if (text === "") {
    return undefined;
  }
  const known = new Set(available);
  const chosen = new Set<number>();
  for (const part of text.split(",")) {
    const piece = part.trim();
    const range = /^(\d+)\s*(?:-|\.\.|:)\s*(\d+)$/.exec(piece);
    const single = /^(\d+)$/.exec(piece);
    if (range !== null) {
      const from = Math.min(Number(range[1]), Number(range[2]));
      const to = Math.max(Number(range[1]), Number(range[2]));
      for (let i = from; i <= to; i++) {
        if (known.has(i)) chosen.add(i);
      }
    } else if (single !== null) {
      if (known.has(Number(single[1]))) chosen.add(Number(single[1]));
    } else {
      return undefined;
    }
  }
  return chosen.size === 0 ? undefined : [...chosen].sort((a, b) => a - b);
}
