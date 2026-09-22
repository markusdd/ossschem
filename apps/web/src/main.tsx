import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell, type ProbeProvider, type WaveformChoice } from "@ossschem/ui";
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
const cursorListeners = new Set<() => void>();
const waveformListeners = new Set<(state: WaveformChoice) => void>();
/** The last state the host sent, for a listener that subscribes after it. */
let waveforms: WaveformChoice = { documents: [] };
/** Outstanding value requests, by the id they were sent with. */
const pendingValues = new Map<number, (values: Record<string, string | string[]>) => void>();
let nextRequest = 0;

if (host !== undefined) {
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data as
      { type?: string; instancePath?: unknown; id?: number; values?: Record<string, string | string[]> } | null;
    if (message?.type === "ossschem/revealSignal" && Array.isArray(message.instancePath)) {
      const path = message.instancePath.filter((part): part is string => typeof part === "string");
      revealListeners.forEach((listener) => { listener(path); });
    } else if (message?.type === "ossschem/cursorMoved") {
      cursorListeners.forEach((listener) => { listener(); });
    } else if (message?.type === "ossschem/waveforms") {
      const state = message as unknown as WaveformChoice;
      waveforms = { documents: state.documents ?? [], active: state.active };
      waveformListeners.forEach((listener) => { listener(waveforms); });
    } else if (message?.type === "ossschem/values" && typeof message.id === "number") {
      pendingValues.get(message.id)?.(message.values ?? {});
      pendingValues.delete(message.id);
    }
  });
}
const probe: ProbeProvider | undefined =
  host === undefined
    ? undefined
    : {
        resolve: () => null,
        onNetPicked: (refs) => {
          host.postMessage({ type: "ossschem/netPicked", instancePaths: refs.map((r) => r.path) });
        },
        onRevealRequest: (cb) => {
          revealListeners.add(cb);
          return () => { revealListeners.delete(cb); };
        },
        onCursorMoved: (cb) => {
          cursorListeners.add(cb);
          return () => { cursorListeners.delete(cb); };
        },
        onWaveformsChanged: (cb) => {
          waveformListeners.add(cb);
          cb(waveforms);
          return () => { waveformListeners.delete(cb); };
        },
        useWaveform: (uri) => {
          host.postMessage({ type: "ossschem/useWaveform", uri });
        },
        values: (paths) =>
          new Promise((resolve) => {
            const id = ++nextRequest;
            pendingValues.set(id, resolve);
            host.postMessage({ type: "ossschem/valuesRequest", id, instancePaths: paths });
            // an unanswered request must not leak, nor hold the annotation back
            window.setTimeout(() => {
              if (pendingValues.delete(id)) {
                resolve({});
              }
            }, 4000);
          }),
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
