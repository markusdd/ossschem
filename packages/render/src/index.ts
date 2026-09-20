/** Imperative SVG renderer. The SVG root is not React-managed. */

export const packageName = "@ossschem/render" as const;

export { attachCanvas, type Camera, type CanvasController, type CanvasScene, type Wire } from "./canvas.js";
export { drawSymbol, symbolSize } from "./symbols.js";
export { attachMinimap } from "./minimap.js";

const NS = "http://www.w3.org/2000/svg";

/** Create an empty schematic SVG under `host`. Safe to call twice (Strict Mode): reuses the existing root. */
export function mountSchematicSvg(host: HTMLElement): SVGSVGElement {
  const existing = host.querySelector(":scope > svg.ossschem-canvas");
  if (existing instanceof SVGSVGElement) {
    return existing;
  }

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "ossschem-canvas");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Schematic canvas");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");

  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("class", "ossschem-canvas-bg");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  svg.appendChild(bg);

  const label = document.createElementNS(NS, "text");
  label.setAttribute("class", "ossschem-canvas-placeholder");
  label.setAttribute("x", "50%");
  label.setAttribute("y", "50%");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.textContent = "ossschem";
  svg.appendChild(label);

  host.appendChild(svg);
  return svg;
}

export { elementBounds, traceFocusKeys, focusCamera } from "./focus.js";
