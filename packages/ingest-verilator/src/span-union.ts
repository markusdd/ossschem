import type { SourceSpan } from "@ossschem/ir";
import { parseLoc } from "./loc.js";
import type { VerilatorDump } from "./parse.js";
import type { VerilatorNode } from "./types.js";
import { walkNodes } from "./walk.js";

export function isDeclSiteVarref(dump: VerilatorDump, varref: VerilatorNode): boolean {
  if (varref.type !== "VARREF" || typeof varref.loc !== "string") {
    return false;
  }
  const v = typeof varref.varp === "string" ? dump.resolve(varref.varp) : undefined;
  return typeof v?.loc === "string" && v.loc === varref.loc;
}

export function unionSpans(spans: SourceSpan[]): SourceSpan | undefined {
  if (spans.length === 0) {
    return undefined;
  }
  const fileId = spans[0].fileId;
  const same = spans.filter((s) => s.fileId === fileId);
  let startLine = same[0].startLine;
  let startCol = same[0].startCol;
  let endLine = same[0].endLine;
  let endCol = same[0].endCol;
  for (const s of same) {
    if (s.startLine < startLine || (s.startLine === startLine && s.startCol < startCol)) {
      startLine = s.startLine;
      startCol = s.startCol;
    }
    if (s.endLine > endLine || (s.endLine === endLine && s.endCol > endCol)) {
      endLine = s.endLine;
      endCol = s.endCol;
    }
  }
  return { fileId, file: same[0].file, startLine, startCol, endLine, endCol };
}

export function spanFromRaw(dump: VerilatorDump, raw: string | undefined): SourceSpan | undefined {
  const loc = dump.loc(raw);
  if (loc === undefined) {
    return undefined;
  }
  return {
    fileId: loc.fileId,
    file: loc.filename,
    startLine: loc.firstLine,
    startCol: loc.firstCol,
    endLine: loc.lastLine,
    endCol: loc.endCol,
  };
}

/** AlwaysBox: union descendant locs, dropping decl-site VARREFs. */
export function alwaysSpan(dump: VerilatorDump, always: VerilatorNode): SourceSpan | undefined {
  const spans: SourceSpan[] = [];
  walkNodes(always, (node) => {
    if (node.type === "VARREF" && isDeclSiteVarref(dump, node)) {
      return;
    }
    const span = spanFromRaw(dump, node.loc);
    if (span !== undefined) {
      spans.push(span);
    }
  });
  return unionSpans(spans);
}

/** AssignBox: ALWAYS.loc ∪ same-line child locs, decl-site VARREFs dropped. */
export function assignSpan(dump: VerilatorDump, always: VerilatorNode): SourceSpan | undefined {
  const self = spanFromRaw(dump, always.loc);
  if (self === undefined) {
    return alwaysSpan(dump, always);
  }
  const spans: SourceSpan[] = [self];
  walkNodes(always, (node) => {
    if (node === always) {
      return;
    }
    if (node.type === "VARREF" && isDeclSiteVarref(dump, node)) {
      return;
    }
    if (typeof node.loc !== "string") {
      return;
    }
    const parsed = parseLoc(node.loc);
    if (parsed.fileId !== self.fileId || parsed.firstLine !== self.startLine) {
      return;
    }
    const span = spanFromRaw(dump, node.loc);
    if (span !== undefined) {
      spans.push(span);
    }
  });
  return unionSpans(spans);
}
