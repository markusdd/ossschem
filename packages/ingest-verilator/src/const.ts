/** Canonicalize a Verilator CONST.name to a decimal string when it is a sized integer. */
export function parseVerilogInt(token: string): string {
  const sized = /^(\d+)'s?([hbdHoBoD])([0-9a-fA-FxXzZ_]+)$/.exec(token);
  if (sized !== null) {
    const baseMap: Record<string, number> = {
      h: 16,
      H: 16,
      b: 2,
      B: 2,
      d: 10,
      D: 10,
      o: 8,
      O: 8,
    };
    const base = baseMap[sized[2]];
    const digits = sized[3].replace(/_/g, "");
    if (/[xXzZ]/.test(digits)) {
      return token;
    }
    return String(parseInt(digits, base));
  }
  if (/^-?\d+$/.test(token)) {
    return token;
  }
  return token;
}

export function constName(valuep: unknown): string | undefined {
  if (!Array.isArray(valuep) || valuep.length === 0) {
    return undefined;
  }
  const first = valuep[0] as { type?: unknown; name?: unknown };
  if (first.type === "CONST" && typeof first.name === "string") {
    return first.name;
  }
  return undefined;
}
