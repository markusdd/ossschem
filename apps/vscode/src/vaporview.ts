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
