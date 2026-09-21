import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell, type ProbeProvider } from "@ossschem/ui";
import type { Design } from "@ossschem/ir";
import logoUrl from "../../../assets/ossschem_logo_gradient.svg";
import bannerUrl from "../../../assets/ossschem_banner.svg";
import "./index.css";

declare global {
  interface Window {
    __OSSSCHEM_DESIGN__?: Design;
    __OSSSCHEM_SOURCES__?: Record<string, string>;
    /** Present only when the page runs inside a VS Code webview. */
    acquireVsCodeApi?: () => { postMessage(message: unknown): void };
  }
}

/* In a webview, hand the selected signal to the extension, which is what can
 * reach the waveform viewer. Standalone there is no host and no probe. */
const host = window.acquireVsCodeApi?.();
host?.postMessage({ type: "ossschem/ready" });

/* The host names a signal it wants shown. Listeners are held in a set so the
 * app can subscribe and unsubscribe without the page caring how many. */
const revealListeners = new Set<(instancePath: string[]) => void>();
if (host !== undefined) {
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data as { type?: string; instancePath?: unknown } | null;
    if (message?.type !== "ossschem/revealSignal" || !Array.isArray(message.instancePath)) {
      return;
    }
    const path = message.instancePath.filter((part): part is string => typeof part === "string");
    revealListeners.forEach((listener) => { listener(path); });
  });
}
const probe: ProbeProvider | undefined =
  host === undefined
    ? undefined
    : {
        resolve: () => null,
        subscribe: () => () => {},
        onNetPicked: (refs) => {
          host.postMessage({ type: "ossschem/netPicked", instancePaths: refs.map((r) => r.path) });
        },
        onRevealRequest: (cb) => {
          revealListeners.add(cb);
          return () => revealListeners.delete(cb);
        },
      };

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
      <AppShell design={design} sources={sourceMap} branding={{ logoUrl, bannerUrl }} probe={probe} />
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
