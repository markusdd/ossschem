import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  defaultSession,
  DEFAULT_FANOUT_LIMIT,
  moduleAtKey,
  buildLevel0Connectivity,
  buildHierarchy, flattenHierarchy, prepareHierarchySelection,
  expandHierarchy, moduleRootKey, revealSignalConnection, type ExpansionMode, type SignalEndpoint,
  copySession, collapseWire, expandComponent, flattenNodes, isolateComponent, advanceTrace, sceneEdges,
  type PinFace, type TraceDirection,
  probeTargets,
  selectionInfo,
  snippet,
  type ViewSession,
} from "@ossschem/graph";
import type { Design } from "@ossschem/ir";
import type { CanvasController } from "@ossschem/render";
import { NullProbeProvider, type ProbeProvider } from "./probe.js";
import { ResizablePanels } from "./ResizablePanels.js";
import { HierarchyPane } from "./HierarchyPane.js";
import { SchematicPane, type ViewportRequest } from "./SchematicPane.js";

const FANOUT_STORAGE_KEY = "ossschem.fanout-limit";
const THEME_STORAGE_KEY = "ossschem.theme";
const WORLD_MAP_STORAGE_KEY = "ossschem.world-map-visible";
const THEMES = [
  { id: "dark", label: "Current Dark", family: "Dark" },
  { id: "tokyo-night", label: "Tokyo Night", family: "Dark" },
  { id: "nord", label: "Nord", family: "Dark" },
  { id: "solarized-dark", label: "Solarized Dark", family: "Dark" },
  { id: "eda-dark", label: "EDA Dark", family: "Dark" },
  { id: "eda-classic-dark", label: "EDA Classic Dark", family: "Dark" },
  { id: "signal-contrast-dark", label: "Signal Contrast Dark", family: "Dark" },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", family: "Dark" },
  { id: "neon-arcade-dark", label: "Neon Arcade Dark", family: "Dark" },
  { id: "fluorescent", label: "Fluorescent", family: "Dark" },
  { id: "x80-dark", label: "80s X Dark", family: "Dark" },
  { id: "monokai-dark", label: "Monokai Dark", family: "Dark" },
  { id: "light", label: "Current Light", family: "Light" },
  { id: "tokyo-day", label: "Tokyo Day", family: "Light" },
  { id: "arctic-light", label: "Arctic Light", family: "Light" },
  { id: "solarized-light", label: "Solarized Light", family: "Light" },
  { id: "eda-light", label: "EDA Light", family: "Light" },
  { id: "eda-classic-light", label: "EDA Classic Light", family: "Light" },
  { id: "signal-contrast-light", label: "Signal Contrast Light", family: "Light" },
  { id: "catppuccin-latte", label: "Catppuccin Latte", family: "Light" },
  { id: "neon-arcade-light", label: "Neon Arcade Light", family: "Light" },
  { id: "fluorescent-light", label: "Fluorescent Light", family: "Light" },
  { id: "x80-light", label: "80s X Light", family: "Light" },
  { id: "monokai-bright", label: "Monokai Bright", family: "Light" },
] as const;
type Theme = typeof THEMES[number]["id"];
type Overlay = "about" | "help";

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return THEMES.some(theme => theme.id === stored) ? stored as Theme : "dark";
  } catch {
    return "dark";
  }
}

function loadFanoutLimit(): number {
  try {
    const stored = localStorage.getItem(FANOUT_STORAGE_KEY);
    const value = stored === null ? DEFAULT_FANOUT_LIMIT : Number(stored);
    if (Number.isSafeInteger(value) && value >= 0) return value;
  } catch { /* Preferences are optional in embedded viewers. */ }
  return DEFAULT_FANOUT_LIMIT;
}

export function AppShell(props: {
  design?: Design | null;
  probe?: ProbeProvider;
  sources?: Record<string, string>;
  branding?: { logoUrl?: string; bannerUrl?: string };
}): ReactElement {
  const design = props.design ?? null;
  const probe = props.probe ?? NullProbeProvider;
  const sources = props.sources ?? {};
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [fanoutLimit, setFanoutLimit] = useState(loadFanoutLimit);
  const [fanoutInput, setFanoutInput] = useState(() => String(fanoutLimit));
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [showWorldMap, setShowWorldMap] = useState(() => {
    try { return localStorage.getItem(WORLD_MAP_STORAGE_KEY) !== "false"; }
    catch { return true; }
  });
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [viewSession, setSession] = useState<ViewSession | null>(() =>
    props.design !== undefined && props.design !== null ? defaultSession(props.design) : null,
  );
  // Display preferences survive navigation and restoring a previous exploration.
  const session = useMemo(() => viewSession ? { ...viewSession, fanoutLimit } : null, [viewSession, fanoutLimit]);
  const [history, setHistory] = useState<ViewSession[]>([]);
  const [traceDirection, setTraceDirection] = useState<"back" | "forward" | null>(null);
  const [viewportRequest, setViewportRequest] = useState<ViewportRequest | null>(null);
  const [ctl, setCtl] = useState<CanvasController | null>(null);
  const onReady = useCallback((next: CanvasController) => {
    setCtl(next);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(FANOUT_STORAGE_KEY, String(fanoutLimit)); }
    catch { /* The control still works without persistent storage. */ }
  }, [fanoutLimit]);

  useEffect(() => {
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); }
    catch { /* The theme still applies when preferences cannot be saved. */ }
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(WORLD_MAP_STORAGE_KEY, String(showWorldMap)); }
    catch { /* Visibility still works without storage. */ }
  }, [showWorldMap]);

  useEffect(() => {
    if (design === null) {
      setSession(null);
      return;
    }
    setSession(defaultSession(design));
    setHistory([]);
    setTraceDirection(null);
    setSelectedKey(null);
  }, [design]);

  const top = session !== null && design !== null ? design.modules[session.moduleId] : undefined;
  const arrays = top?.instances.filter((i) => i.kind === "instanceArray") ?? [];
  const info = useMemo(
    () => (design !== null && session !== null ? selectionInfo(design, session, selectedKey) : null),
    [design, session, selectedKey],
  );
  const srcText = info?.fileBasename !== undefined ? sources[info.fileBasename] : undefined;
  const snip = info?.span !== undefined && srcText !== undefined ? snippet(srcText, info.span, 2) : null;

  const mutateSession = useCallback((fn: (s: ViewSession) => ViewSession) => {
    setSession((prev) => (prev === null ? prev : fn(copySession({ ...prev, fanoutLimit, trace: undefined }))));
  }, [fanoutLimit]);

  const hierarchy = useMemo(() => design && session ? buildHierarchy(design, session) : [], [design, session?.moduleId, session?.path]);
  const structuralItems = flattenHierarchy(hierarchy);
  const rootKey = session ? moduleRootKey(session) : null;
  const rootSelected = rootKey !== null && selectedKey === rootKey;
  const hierarchyGraph = useMemo(() => design && session
    ? buildLevel0Connectivity(design, undefined, session, true) : { nodes: [], edges: [] }, [design, session]);
  const hierarchyNodes = hierarchyGraph.nodes;
  const selectedWire = sceneEdges(hierarchyGraph).find(e => e.key === selectedKey);
  const selectedNode = structuralItems.find(n => n.key === selectedKey?.split("::")[0]) ??
    flattenNodes(hierarchyNodes).find(n => n.key === selectedKey?.split("::")[0]);
  const canExpand = rootSelected || (!!selectedNode && ["always", "assign", "instance", "instanceArray"].includes(selectedNode.kind));
  const canExpandStructure = rootSelected || (!!selectedNode && ["instance", "instanceArray"].includes(selectedNode.kind));
  const parentArray = structuralItems.find(n => n.key === selectedNode?.key)?.ancestors.at(-1);
  const canCollapse = rootSelected || !!selectedWire || (!!selectedNode && !!session && (
    session.expansion.has(selectedNode.key) || session.exploded.has(selectedNode.key) ||
    (selectedNode.kind === "instance" && parentArray?.kind === "instanceArray" && session.exploded.has(parentArray.key))));
  const prepareSelection = useCallback((s: ViewSession, key: string): ViewSession => {
    const item = flattenHierarchy(hierarchy).find(n => n.key === key.split("::")[0]);
    return item ? prepareHierarchySelection(s, item) : s;
  }, [hierarchy]);
  const expandOrExplode = useCallback((key: string, expandOnly = false) => {
    setViewportRequest({ key: key.split("::")[0], fit: key === rootKey });
    if (design) mutateSession(s => key === moduleRootKey(s)
      ? expandHierarchy(design, s, key, "structure")
      : expandComponent(design, prepareSelection(s, key), key, expandOnly));
  }, [design, mutateSession, prepareSelection, rootKey]);

  const expandSubtree = useCallback((mode: ExpansionMode) => {
    if (!design || !selectedKey) return;
    const key = selectedKey.split("::")[0];
    setViewportRequest({ key, fit: key === rootKey });
    mutateSession(s => expandHierarchy(design, s, key, mode));
  }, [design, selectedKey, rootKey, mutateSession]);

  const revealEndpoint = useCallback((endpoint: SignalEndpoint, logic = false) => {
    if (!design || !selectedKey) return;
    setViewportRequest({ key: endpoint.nodeKey, keys: [selectedKey, endpoint.pinKey, endpoint.nodeKey] });
    setTraceDirection(null);
    mutateSession(s => {
      const revealed = revealSignalConnection(design, s, selectedKey, endpoint.pinKey);
      return logic ? expandHierarchy(design, revealed, endpoint.nodeKey, "logic") : revealed;
    });
  }, [design, selectedKey, mutateSession]);

  const isolate = useCallback((key: string) => {
    if (!design) return;
    setViewportRequest(null);
    mutateSession(s => isolateComponent(design, prepareSelection(s, key), key));
    setSelectedKey(key.split("::")[0]);
    setTraceDirection(null);
  }, [design, mutateSession, prepareSelection]);
  const showAll = useCallback(() => {
    setViewportRequest(null);
    mutateSession(s => ({ ...s, visible: undefined }));
    setTraceDirection(null);
  }, [mutateSession]);

  const collapse = useCallback(() => {
    if (selectedKey === null || !canCollapse) {
      return;
    }
    if (selectedWire) {
      setTraceDirection(null);
      setViewportRequest({ key: selectedWire.sourcePin,
        keys: [selectedWire.sourcePin, selectedWire.targetPin, selectedWire.sourceKey, selectedWire.targetKey] });
      mutateSession(s => collapseWire(s, selectedWire.key));
      setSelectedKey(selectedWire.sourcePin);
      return;
    }
    const nodeKey = selectedKey.split("::")[0];
    setViewportRequest({ key: nodeKey, fit: rootSelected });
    mutateSession((s) => {
      if (nodeKey === moduleRootKey(s)) {
        s.expansion.clear();
        s.exploded.clear();
        s.partial?.clear();
        s.visible = undefined;
        return s;
      }
      s.visible?.add(nodeKey);
      s.exploded.delete(nodeKey);
      const wasExpanded = s.expansion.delete(nodeKey);
      s.partial?.delete(nodeKey);
      if (!wasExpanded && design) {
        const owner = moduleAtKey(design, s, nodeKey);
        const array = design.modules[owner.moduleId]?.instances.find(i =>
          i.kind === "instanceArray" && i.members.includes(nodeKey.split("#")[1]));
        if (array) {
          const arrayKey = `${owner.path.join("/")}#${array.id}`;
          s.exploded.delete(arrayKey);
          s.visible?.add(arrayKey);
        }
      }
      return s;
    });
  }, [design, mutateSession, selectedKey, rootSelected, canCollapse, selectedWire]);

  const drillIn = useCallback(() => {
    if (!design || !session || !selectedKey) return;
    const owner = moduleAtKey(design, session, selectedKey);
    const inst = design.modules[owner.moduleId]?.instances.find(i => i.id === selectedKey.split("::")[0].split("#")[1]);
    if (inst?.kind !== "instance") return;
    setHistory(h => [...h, session]);
    setSession({ moduleId: inst.module, path: [...owner.path, ...inst.relPath], exploded: new Set(), expansion: new Set() });
    setSelectedKey(null);
  }, [design, session, selectedKey]);

  const drillOut = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setSession(previous);
    setHistory(h => h.slice(0, -1));
    setSelectedKey(null);
  }, [history]);

  const selectElement = useCallback((key: string | null) => {
    setSelectedKey(key);
    setTraceDirection(null);
  }, []);

  const tracePin = useCallback((key: string, direction: TraceDirection, face?: PinFace) => {
    if (!design) return;
    setViewportRequest({ key, direction });
    const restart = face !== undefined || traceDirection !== direction || selectedKey !== key;
    setSession(previous => {
      if (!previous) return previous;
      if (!restart && previous.trace?.origin === key && previous.trace.direction === direction && !previous.trace.frontier.length) return previous;
      return advanceTrace(design, { ...previous, fanoutLimit }, key, direction, { restart });
    });
    setSelectedKey(key);
    setTraceDirection(direction);
  }, [design, fanoutLimit, traceDirection, selectedKey]);

  const trace = useCallback((direction: TraceDirection, into = false) => {
    if (!selectedKey) return;
    tracePin(selectedKey, direction, into ? "inside" : undefined);
  }, [selectedKey, tracePin]);

  const activeTrace = traceDirection && session?.trace?.origin === selectedKey && session.trace.direction === traceDirection
    ? session.trace : undefined;
  useEffect(() => {
    ctl?.setCone(viewportRequest?.keys && viewportRequest.keys[0] === selectedKey ? viewportRequest.keys : [...activeTrace?.keys ?? []],
      activeTrace?.frontier.map(key => key.split("::")[0]));
  }, [ctl, selectedKey, viewportRequest, activeTrace]);

  /* Cross probing is an explicit act: browsing the schematic should not fill
   * the waveform viewer with everything the pointer touched. A signal with no
   * counterpart in a dump offers nothing rather than guessing a name. */
  const canProbe = probe.onNetPicked !== undefined;
  const probePaths = useMemo(
    () => (canProbe && design !== null && session !== null ? probeTargets(design, session, selectedKey) : []),
    [canProbe, design, session, selectedKey],
  );
  const sendToWaveform = useCallback(() => {
    if (probePaths.length === 0) {
      return;
    }
    probe.onNetPicked?.(probePaths.map((path) => ({ path, net: path[path.length - 1] })));
  }, [probe, probePaths]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.target instanceof HTMLElement && (ev.target.closest("input, textarea, select, [contenteditable=true]") ||
          (ev.target.closest("button") && (ev.key === "Enter" || ev.key === " ")))) {
        return;
      }
      if (ev.key === "h" || ev.key === "H") {
        setOverlay(current => current === "help" ? null : "help");
      } else if (ev.key === "Escape" && overlay !== null) {
        setOverlay(null);
      } else if (overlay !== null) {
        return;
      } else if (ev.key === "b" || ev.key === "B") {
        trace("back", ev.shiftKey);
      } else if (ev.key === "f" || ev.key === "F") {
        trace("forward", ev.shiftKey);
      } else if (ev.key === "e" || ev.key === "E") {
        if (selectedKey !== null) {
          expandOrExplode(selectedKey);
        }
      } else if (ev.key === "l" || ev.key === "L") {
        expandSubtree("logic");
      } else if ((ev.key === "i" || ev.key === "I") && selectedNode) {
        isolate(selectedNode.key);
      } else if (ev.key === "w" || ev.key === "W") {
        sendToWaveform();
      } else if (ev.key === "c" || ev.key === "C") {
        collapse();
      } else if (ev.key === "Enter" && selectedKey !== null) {
        drillIn();
      } else if (ev.key === "Backspace") {
        drillOut();
      } else if (ev.key === "Escape") {
        setTraceDirection(null);
        setSelectedKey(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapse, ctl, drillIn, drillOut, expandOrExplode, expandSubtree, overlay, selectedKey, selectedNode, isolate, sendToWaveform, trace]);


  return (
    <div className="ossschem-shell" data-theme={theme}>
      <header className="ossschem-toolbar">
        <button type="button" className="ossschem-brand" aria-label="About ossschem" onClick={() => setOverlay("about")}>
          {props.branding?.logoUrl && <img className="ossschem-logo" src={props.branding.logoUrl} alt="" />}
          <span className="ossschem-wordmark">ossschem</span>
        </button>
        <button type="button" disabled>
          Open
        </button>
        <button type="button" onClick={() => setOverlay("help")}>
          Help <kbd>H</kbd>
        </button>
        <button type="button" onClick={() => ctl?.zoomToFit()} disabled={design === null}>
          Fit
        </button>
        <button type="button" aria-pressed={showWorldMap} title="Show or hide the navigation overview"
          onClick={() => setShowWorldMap(shown => !shown)}>World map</button>
        <button type="button" onClick={() => trace("back")} disabled={selectedKey === null}>
          Trace ◀ <kbd>B</kbd>
        </button>
        <button type="button" onClick={() => trace("forward")} disabled={selectedKey === null}>
          Trace ▶ <kbd>F</kbd>
        </button>
        <button type="button" onClick={() => expandSubtree("structure")} disabled={!canExpandStructure}>Expand structure <kbd>E</kbd></button>
        <button type="button" onClick={() => expandSubtree("logic")} disabled={!canExpand}>Expand logic <kbd>L</kbd></button>
        <button type="button" onClick={() => selectedNode && isolate(selectedNode.key)} disabled={!selectedNode}>Isolate <kbd>I</kbd></button>
        {canProbe && (
          <button type="button" onClick={sendToWaveform} disabled={probePaths.length === 0}
            title={probePaths.length === 0
              ? "Select a signal to add it to the waveform viewer"
              : probePaths.map((p) => p.join(".")).join("\n")}>
            Waveform <kbd>W</kbd>
          </button>
        )}
        <button type="button" onClick={showAll} disabled={!session?.visible}>Show all</button>
        <button type="button" onClick={collapse} disabled={!canCollapse}>Collapse <kbd>C</kbd></button>
        <button type="button" onClick={drillOut} disabled={history.length === 0}>
          Back <kbd>⌫</kbd>
        </button>
        <span className="ossschem-crumb">{session?.path.join(" › ")}</span>
        <span className="ossschem-toolbar-spacer" />
        <label className="ossschem-fanout" title="Hide nets with this many loads or more within each module. 0 disables the fanout limit. Outer clocks/resets stay hidden until traced; explicitly traced wires stay visible.">
          Hide fanout ≥
          <input type="number" min="0" step="1" value={fanoutInput} aria-label="Fanout hiding threshold"
            onChange={ev => {
              const value = ev.currentTarget.value;
              setFanoutInput(value);
              const limit = Number(value);
              if (value.trim() && Number.isSafeInteger(limit) && limit >= 0) {
                setViewportRequest(null);
                setFanoutLimit(limit);
              }
            }}
            onBlur={() => setFanoutInput(String(fanoutLimit))} />
          <span className="ossschem-fanout-hint">0 = off</span>
        </label>
        <label className="ossschem-theme">
          Theme
          <select value={theme} aria-label="Theme" onChange={ev => setTheme(ev.currentTarget.value as Theme)}>
            {(["Dark", "Light"] as const).map(family => (
              <optgroup key={family} label={family}>
                {THEMES.filter(theme => theme.family === family).map(option => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="ossschem-find">
          Find net
          <input type="search" disabled placeholder="later" />
        </label>
      </header>
      <ResizablePanels left={
        <HierarchyPane
          key={session?.path.join("/")}
          moduleName={top?.name} moduleKey={rootKey ?? undefined} items={hierarchy} selectedKey={rootSelected ? rootKey : selectedNode?.key ?? null}
          canIsolate={!!selectedNode} canExpand={canExpand} canExpandStructure={canExpandStructure} canCollapse={canCollapse}
          onSelect={selectElement} onExpand={key => expandOrExplode(key, true)}
          onExpandStructure={() => expandSubtree("structure")} onExpandLogic={() => expandSubtree("logic")}
          onIsolate={() => { if (selectedNode) isolate(selectedNode.key); }} onCollapse={collapse}
        />
      } bottom={
        <aside className="ossschem-source" aria-label="Source">
          <h2>{info?.sourceKind === "declaration" ? "Declaration" : info?.sourceKind === "expression" ? "Expression source" : "Source"}{info?.fileBasename ? ` · ${info.fileBasename}:${info.span?.startLine}` : ""}</h2>
          {snip === null || info === null ? (
            <p className="ossschem-muted">{info?.title ?? "Select an element."}</p>
          ) : (
            <pre className="ossschem-snippet">
              {snip.text.split("\n").map((line, i) => {
                const ln = snip.startLine + i;
                const on = ln >= snip.hl[0] && ln <= snip.hl[1];
                return (
                  <div key={ln} className={on ? "ossschem-hl" : undefined}>
                    <span className="ossschem-ln">{ln}</span>
                    {line}
                  </div>
                );
              })}
            </pre>
          )}
          {info?.expr && <><h2>Expression</h2><p className="ossschem-muted">{info.expr}</p></>}
          {info?.signal && <div className="ossschem-connections">
            {(["drivers", "loads"] as const).map(role => <section key={role} aria-label={role === "drivers" ? "Drivers" : "Loads"}>
              <h2>{role === "drivers" ? "Drivers" : "Loads"} ({info.signal![role].length})</h2>
              {info.signal![role].length === 0 ? <p className="ossschem-muted">No {role} recorded.</p> : <ul>
                {info.signal![role].map(endpoint => <li key={endpoint.pinKey}>
                  <button type="button" className="ossschem-connection-select" onClick={() => selectElement(endpoint.nodeKey)} title="Select component and show its source">{endpoint.title}</button>
                  <button type="button" onClick={() => revealEndpoint(endpoint)}>Reveal</button>
                  {endpoint.canExpand && <button type="button" onClick={() => revealEndpoint(endpoint, true)}>Expand logic</button>}
                </li>)}
              </ul>}
            </section>)}
          </div>}
        </aside>
      }>
        <main className="ossschem-canvas-wrap" aria-label="Schematic">
          <SchematicPane
            design={design}
            session={session}
            selectedKey={selectedKey}
            viewportRequest={viewportRequest}
            showWorldMap={showWorldMap}
            theme={theme}
            onSelect={selectElement}
            onDblClick={expandOrExplode}
            onTracePin={tracePin}
            onReady={onReady}
          />
        </main>
      </ResizablePanels>
      <footer className="ossschem-status">
        {top === undefined
          ? "No design · canvas ready"
          : `${session?.visible ? "Isolated view · " : ""}${top.name} · ${top.ports.length} ports · ${top.boxes.length} boxes · ${arrays.length} arrays`}
        {activeTrace && <span className="ossschem-trace-status" role="status">
          {` · ${activeTrace.direction === "forward" ? "Forward" : "Backward"} trace · step ${activeTrace.step} · ${activeTrace.frontier.length ? `${activeTrace.frontier.length} active branches` : "complete"}`}
        </span>}
      </footer>
      {overlay !== null && (
        <div className="ossschem-dialog-backdrop" role="presentation"
          onMouseDown={ev => { if (ev.target === ev.currentTarget) setOverlay(null); }}>
          <section className={`ossschem-dialog ossschem-dialog-${overlay}`} role="dialog" aria-modal="true"
            aria-labelledby={overlay === "help" ? "ossschem-help-title" : "ossschem-about-title"}>
            <header className="ossschem-dialog-header">
              <div className="ossschem-dialog-heading">
                {props.branding?.logoUrl && <img className="ossschem-dialog-logo" src={props.branding.logoUrl} alt="" />}
                <h1 id={overlay === "help" ? "ossschem-help-title" : "ossschem-about-title"}>
                  {overlay === "help" ? "ossschem Help" : "About ossschem"}
                </h1>
              </div>
              <button type="button" className="ossschem-dialog-close" aria-label="Close" onClick={() => setOverlay(null)}>×</button>
            </header>
            {overlay === "about" ? (
              <>
                {props.branding?.bannerUrl && <img className="ossschem-about-banner" src={props.branding.bannerUrl} alt="ossschem schematic artwork" />}
                <div className="ossschem-dialog-body">
                  <p className="ossschem-about-lede">An open-source interactive schematic tracer for RTL designs.</p>
                  <p>Explore Verilator JSON dumps as a navigable schematic without first running a synthesis netlister. Trace signals, expand logic in place, inspect source, and isolate the part of the design you are following.</p>
                  <p className="ossschem-about-meta"><a href="https://github.com/markusdd" target="_blank" rel="noreferrer">markusdd</a> · 2026 · MIT License</p>
                </div>
              </>
            ) : (
              <div className="ossschem-dialog-body ossschem-help-body">
                <section>
                  <h2>Shortcuts</h2>
                  <dl className="ossschem-shortcuts">
                    <div><dt><kbd>H</kbd></dt><dd>Open this help screen</dd></div>
                    <div><dt><kbd>Wheel</kbd></dt><dd>Zoom around the pointer</dd></div>
                    <div><dt><kbd>Drag</kbd></dt><dd>Draw a rectangle to zoom to an area</dd></div>
                    <div><dt><kbd>Space</kbd> + drag</dt><dd>Pan the schematic</dd></div>
                    <div><dt><kbd>Double-click</kbd></dt><dd>Expand a component or trace from a pin</dd></div>
                    <div><dt><kbd>B</kbd> / <kbd>F</kbd></dt><dd>Trace backward to drivers or forward to loads; repeat to advance the cone</dd></div>
                    <div><dt><kbd>Shift</kbd> + <kbd>B/F</kbd></dt><dd>Trace through a boundary</dd></div>
                    <div><dt><kbd>E</kbd></dt><dd>Expand the selected component's structure</dd></div>
                    <div><dt><kbd>L</kbd></dt><dd>Expand logic beneath the selected component</dd></div>
                    <div><dt><kbd>I</kbd></dt><dd>Isolate the selected component</dd></div>
                    <div><dt><kbd>C</kbd></dt><dd>Collapse the selected component or wire</dd></div>
                    {canProbe && <div><dt><kbd>W</kbd></dt><dd>Add the selected signal to the waveform viewer</dd></div>}
                    <div><dt><kbd>Esc</kbd></dt><dd>Close dialogs or clear the current selection</dd></div>
                  </dl>
                </section>
                <section>
                  <h2>Useful operations</h2>
                  <ul className="ossschem-help-list">
                    <li>Press <strong>F</strong> or <strong>B</strong> repeatedly to advance all active trace branches. Registers pass through to Q going forward; backward tracing follows data and enable, excluding clock and reset. Select another element or press Escape to start fresh.</li>
                    <li>Toggle <strong>World map</strong> in the toolbar. Click the map to recenter or drag its view box to pan without changing zoom. Drag its upper-left corner to resize it, up to 30% of the schematic viewport area.</li>
                    <li>Use <strong>Expand structure</strong> to reveal processes, assignments, and sub-instances.</li>
                    <li>Use <strong>Expand logic</strong> to reveal the internals of a selected process or instance.</li>
                    <li>Select a wire or port to inspect its source, drivers, loads, and bus width in the bottom pane.</li>
                    {canProbe && <li>Select a signal and press <strong>W</strong> (or the <strong>Waveform</strong> button) to add it to the waveform viewer. A signal already shown there is selected rather than added twice. An unpacked array asks which elements to add: Enter accepts the default, or type an index, a range like <strong>0-7</strong>, or a list like <strong>0,2,5</strong>.</li>}
                    <li>Use the <strong>Hide fanout</strong> control to keep large, noisy nets out of the initial view.</li>
                    <li>Choose a current, Tokyo, Nord, Arctic, Solarized, EDA, EDA Classic, Signal Contrast, Catppuccin, Neon Arcade, Fluorescent, 80s X, or Monokai palette from the theme selector; the preference is remembered.</li>
                  </ul>
                </section>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
