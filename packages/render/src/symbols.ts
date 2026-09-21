import { flipFlopPorts } from "@ossschem/graph";

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>, ...kids: Node[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  for (const kid of kids) {
    node.appendChild(kid);
  }
  return node;
}

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2.2",
  "stroke-linejoin": "round",
  "stroke-linecap": "round",
};

function path(d: string): SVGPathElement {
  return el("path", { d, ...STROKE });
}

function txt(x: number, y: number, s: string, size = "15"): SVGTextElement {
  return el(
    "text",
    {
      x: String(x),
      y: String(y),
      "text-anchor": "middle",
      fill: "currentColor",
      "font-size": size,
      "font-weight": "500",
      "font-family": "ui-sans-serif, system-ui, sans-serif",
    },
    document.createTextNode(s),
  );
}

/** Outline IEEE-style glyphs. Fill is never solid — CSS color comes from currentColor. */
export function drawSymbol(kind: string, w: number, h: number): SVGSVGElement {
  const svg = el("svg", {
    class: "ossschem-symbol",
    x: "0",
    y: "0",
    width: String(w),
    height: String(h),
    viewBox: "0 0 80 64",
    preserveAspectRatio: "xMidYMid meet",
    overflow: "visible",
  });
  svg.appendChild(glyph(kind));
  return svg;
}

export function symbolSize(kind: string): { w: number; h: number } {
  switch (kind) {
    case "not":
    case "buf":
      return { w: 56, h: 48 };
    case "and":
    case "or":
    case "xor":
      return { w: 64, h: 52 };
    case "mux":
      return { w: 56, h: 64 };
    case "dff":
    case "adff":
    case "dffe":
    case "adffe":
      return { w: 72, h: 80 };
    default:
      return { w: 64, h: 52 };
  }
}

function glyph(kind: string): SVGGElement {
  const g = el("g", { class: "ossschem-glyph" });
  switch (kind) {
    case "not":
      g.append(path("M8,10 L8,54 L50,32 Z"), el("circle", { cx: "58", cy: "32", r: "6", ...STROKE }));
      break;
    case "buf":
      g.append(path("M8,10 L8,54 L58,32 Z"));
      break;
    case "and":
      g.append(path("M8,10 H42 A22,22 0 0 1 42,54 H8 Z"));
      break;
    case "or":
      g.append(path("M8,10 Q32,10 62,32 Q32,54 8,54 Q22,32 8,10"));
      break;
    case "xor":
      g.append(path("M4,10 Q16,32 4,54"), path("M12,10 Q36,10 64,32 Q36,54 12,54 Q26,32 12,10"));
      break;
    case "mux":
      g.append(path("M22,8 L58,18 L58,46 L22,56 Z"), txt(40, 36, "1"));
      break;
    case "dff":
    case "adff":
    case "dffe":
    case "adffe":
      g.append(path("M18,4 H62 V60 H18 Z"), path("M18,47 L25,52 L18,57"));
      for (const [name, pin] of Object.entries(flipFlopPorts(kind))) {
        if (name === "CLK") continue;
        const label = txt(pin.vx + (name === "Q" ? -6 : 6), pin.vy, name === "ARST" ? "R" : name === "EN" ? "E" : name, "10");
        label.setAttribute("text-anchor", name === "Q" ? "end" : "start");
        label.setAttribute("dominant-baseline", "central");
        g.append(label);
      }
      break;
    case "slice":
      g.append(path("M16,16 H48 V48 H16 Z"), path("M48,22 H64 M48,42 H64 M56,22 V42"), txt(32, 36, "[ ]"));
      break;
    case "concat":
      g.append(path("M14,16 H28 V26 H14 M14,38 H28 V48 H14"), path("M28,21 H40 M28,43 H40 M40,21 V43"), path("M40,16 H66 V48 H40 Z"), txt(53, 36, "{ }"));
      break;
    case "eq":
      g.append(path("M16,16 H64 V48 H16 Z"), txt(40, 38, "=="));
      break;
    case "add":
      g.append(path("M16,16 H64 V48 H16 Z"), txt(40, 38, "+"));
      break;
    case "sub":
      g.append(path("M16,16 H64 V48 H16 Z"), txt(40, 38, "-"));
      break;
    case "shiftr":
      g.append(path("M16,16 H64 V48 H16 Z"), txt(40, 38, ">>"));
      break;
    case "shiftl":
      g.append(path("M16,16 H64 V48 H16 Z"), txt(40, 38, "<<"));
      break;
    case "memrd":
    case "memwr":
      g.append(path("M14,8 H66 V56 H14 Z"), path("M14,24 H66"), txt(40, 20, "MEM", "12"), txt(40, 45, kind === "memwr" ? "WR" : "RD"));
      break;
    case "extend":
      g.append(path("M16,18 H48 V46 H16 Z"), path("M48,24 L64,32 L48,40"));
      break;
    default:
      g.append(path("M16,16 H64 V48 H16 Z"), txt(40, 38, kind.slice(0, 4)));
  }
  return g;
}
