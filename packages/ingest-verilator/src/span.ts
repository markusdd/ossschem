import type { SourceSpan } from "@ossschem/ir";
import type { VerilatorDump } from "./parse.js";
import type { VerilatorNode } from "./types.js";

export function nodeSpan(dump: VerilatorDump, node: VerilatorNode | undefined): SourceSpan {
  const loc = dump.loc(node);
  if (loc === undefined) {
    return {
      fileId: "?",
      file: "",
      startLine: 0,
      startCol: 0,
      endLine: 0,
      endCol: 0,
    };
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
