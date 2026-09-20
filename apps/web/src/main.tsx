import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@ossschem/ui";
import type { Design } from "@ossschem/ir";
import logoUrl from "../../../assets/ossschem_logo_gradient.svg";
import bannerUrl from "../../../assets/ossschem_banner.svg";
import "./index.css";

declare global {
  interface Window {
    __OSSSCHEM_DESIGN__?: Design;
    __OSSSCHEM_SOURCES__?: Record<string, string>;
  }
}

const sourceGlob = import.meta.glob("../../../fixtures/svb_afifo/src/*.sv", {
  query: "?raw",
  eager: true,
  import: "default",
}) as Record<string, string>;

const sources: Record<string, string> = {};
for (const [path, text] of Object.entries(sourceGlob)) {
  const base = path.split("/").pop();
  if (base !== undefined) {
    sources[base] = text;
  }
}

const root = document.getElementById("root");
if (root === null) {
  throw new Error("missing #root");
}

const reactRoot = createRoot(root);

function render(design: Design | null, sourceMap: Record<string, string> = sources): void {
  reactRoot.render(
    <StrictMode>
      <AppShell design={design} sources={sourceMap} branding={{ logoUrl, bannerUrl }} />
    </StrictMode>,
  );
}

const embeddedDesign = window.__OSSSCHEM_DESIGN__;
const embeddedSources = window.__OSSSCHEM_SOURCES__;
render(embeddedDesign ?? null, embeddedSources ?? sources);

if (embeddedDesign === undefined) {
  void fetch("/schematic-ir.json")
    .then((res) => {
      if (!res.ok) throw new Error(`demo IR ${res.status}`);
      return res.json() as Promise<Design>;
    })
    .then((design) => {
      render(design, embeddedSources);
    })
    .catch((err: unknown) => {
      console.error(err);
    });
}
