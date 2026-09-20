import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@ossschem/ui";
import type { Design } from "@ossschem/ir";
import logoUrl from "../../../assets/ossschem_logo_gradient.svg";
import bannerUrl from "../../../assets/ossschem_banner.svg";
import "./index.css";

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

function render(design: Design | null): void {
  reactRoot.render(
    <StrictMode>
      <AppShell design={design} sources={sources} branding={{ logoUrl, bannerUrl }} />
    </StrictMode>,
  );
}

render(null);

void fetch("/schematic-ir.json")
  .then((res) => {
    if (!res.ok) {
      throw new Error(`demo IR ${res.status}`);
    }
    return res.json() as Promise<Design>;
  })
  .then((design) => {
    render(design);
  })
  .catch((err: unknown) => {
    console.error(err);
  });
