/**
 * Signal values from a waveform viewer, written the way Verilog writes them.
 *
 * A viewer answers with raw bits and, for a value that just changed, with the
 * pair either side of the cursor. What comes back is ambiguous on its own --
 * `["0", "1"]` is a transition for a one bit signal and the two bits of a two
 * bit one -- so the net's declared width decides which it is.
 */

function verilog(bits: string, declared: number): string {
  const text = bits.trim();
  if (text === "") {
    return "";
  }
  // already formatted by the viewer
  if (text.includes("'")) {
    return text;
  }
  /* More bits than the schematic expected means the declared width is not to
   * be trusted here; fewer just means the viewer trimmed leading zeroes. */
  const width = Math.max(declared, text.length);
  if (width <= 1) {
    return `1'b${text}`;
  }
  if (!/^[01]+$/.test(text)) {
    return `${width}'b${text}`;
  }
  const digits = Math.ceil(width / 4);
  return `${width}'h${BigInt(`0b${text}`).toString(16).padStart(digits, "0")}`;
}

/** `8'h0f→a3` rather than repeating the width and radix. */
function transition(before: string, after: string): string {
  const mark = after.indexOf("'");
  if (mark > 0 && before.startsWith(after.slice(0, mark + 2))) {
    return `${before}→${after.slice(mark + 2)}`;
  }
  return `${before}→${after}`;
}

/* A viewer may answer with the values themselves, or with a JSON-ish string
 * it built around them -- vaporview 1.5.4 hands back text like `[],"0"`, the
 * empty list standing for "nothing before the cursor". Pull the values out of
 * whatever arrived, so a wrapper never reaches the drawing. */
function tokens(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap(tokens);
  }
  if (typeof raw !== "string") {
    return [];
  }
  const text = raw.trim();
  if (text === "") {
    return [];
  }
  if (text.includes('"')) {
    return [...text.matchAll(/"([^"]*)"/g)].map((m) => m[1]).filter((value) => value !== "");
  }
  if (text.startsWith("[")) {
    return text.replace(/[[\]]/g, "").split(",").map((part) => part.trim()).filter((part) => part !== "");
  }
  return [text];
}

/* `width` is the declared width where the schematic knows it. Without it the
 * value speaks for itself: a viewer that answers with bits has already said
 * how many there are. */
export function formatSignalValue(raw: string | string[], width?: number): string {
  const values = tokens(raw);
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    return verilog(values[0], width ?? values[0].length);
  }
  // one entry per bit: the viewer split the vector rather than the history
  const singles = values.every((bit) => bit.length === 1);
  const perBit = width === undefined ? singles && values.length > 2 : singles && values.length === width && width > 1;
  if (perBit) {
    return verilog(values.join(""), width ?? values.length);
  }
  if (values.length === 2) {
    return transition(verilog(values[0], width ?? values[0].length), verilog(values[1], width ?? values[1].length));
  }
  const last = values[values.length - 1];
  return verilog(last, width ?? last.length);
}
