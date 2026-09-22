/**
 * VS Code host for the ossschem viewer.
 *
 * The webview runs the same bundle the standalone page runs, booted the same
 * way -- the design and the source text are handed over on `window` -- so the
 * extension stays a thin host and there is only ever one viewer to maintain.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as vscode from "vscode";

import { arrayShape, chooseDocument, documentLabels, openDocuments, parseIndexSpec, pathCandidates,
  SMALL_ARRAY, type OpenDocuments } from "./vaporview.js";
import { viewerHtml } from "./webview-html.js";

/** What `ossschem build` writes, and what `ossschem dump --out` is called. */
const SCHEMATIC_IR = /(^schematic-ir\.json$|\.ir\.json$)/;

/** The built viewer: bundled with the extension, or the repo's copy in dev. */
function findViewer(context: vscode.ExtensionContext): string | undefined {
  const base = context.extensionUri.fsPath;
  const candidates = [
    join(base, "viewer"),
    resolve(base, "..", "..", "packages", "cli", "viewer"),
    resolve(base, "..", "web", "dist"),
  ];
  return candidates.find((dir) => existsSync(join(dir, "index.html")));
}

/** Source text written next to the IR by `ossschem build`, when it is there. */
function readSources(irPath: string): Record<string, string> {
  const beside = join(dirname(irPath), "sources.json");
  if (!existsSync(beside)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(beside, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

const VAPORVIEW = "lramseyer.vaporview";
/** vaporview's custom editor, which is how its tabs are recognised. */
const WAVEFORM_EDITOR = "vaporview.waveformViewer";

/** Selection is forwarded to the waveform viewer unless the user turns it off. */
let linkSelection = true;
let warnedNoViewer = false;
/* Cross probing depends on another extension, so every step is logged: silent
 * failure here is indistinguishable from "nothing happened". */
let log: vscode.OutputChannel | undefined;
/** The last thing the schematic offered, for the diagnostic command. */
let lastPicked: string[][] = [];
/** The waveform in use, shown in the schematic's sidebar and switched from there. */
let chosenWaveform: string | undefined;
/** Open schematic panels, so a selection in the waveform can reach them. */
const panels = new Set<vscode.WebviewPanel>();
let listeningToViewer = false;

function trace(message: string): void {
  log?.appendLine(`${new Date().toISOString().slice(11, 19)} ${message}`);
}

interface NetPicked {
  type: "ossschem/netPicked";
  /** One gesture can mean several signals: an array is all of its elements. */
  instancePaths: string[][];
}

function isNetPicked(message: unknown): message is NetPicked {
  const m = message as NetPicked | undefined;
  return m?.type === "ossschem/netPicked" && Array.isArray(m.instancePaths) && m.instancePaths.length > 0;
}

/* vaporview's documented API: a variable is addressed by its instance path,
 * and `reveal` selects one that is already displayed instead of adding it a
 * second time. */
/* The waveform documents currently on screen, most likely intended first: the
 * focused tab, then the other groups' active tabs, then anything else open.
 * Reported the way vaporview names them, so the two lists can be compared. */
function waveformsOnScreen(open: string[]): string[] {
  const byPath = new Map(open.map((uri) => [vscode.Uri.parse(uri).fsPath, uri]));
  const groups = [...vscode.window.tabGroups.all];
  groups.sort((a, b) => Number(b.isActive) - Number(a.isActive));
  const tabs = [...groups.flatMap((g) => (g.activeTab === undefined ? [] : [g.activeTab])),
    ...groups.flatMap((g) => g.tabs)];
  const shown: string[] = [];
  for (const tab of tabs) {
    const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
    if (input?.uri === undefined || input.viewType !== WAVEFORM_EDITOR) {
      continue;
    }
    const uri = byPath.get(input.uri.fsPath);
    if (uri !== undefined && !shown.includes(uri)) {
      shown.push(uri);
    }
  }
  return shown;
}

/** Every dump vaporview has open, in the order it lists them. */
async function openWaveforms(): Promise<string[]> {
  try {
    return openDocuments(await vscode.commands.executeCommand<OpenDocuments>("waveformViewer.getOpenDocuments"));
  } catch (err) {
    trace(`  could not ask vaporview for its documents: ${String(err)}`);
    return [];
  }
}

/* The waveform every operation works against: the one the picker in the
 * sidebar names. Settled once and then left alone, so signals are added to
 * the dump whose values are on the wires. */
async function activeWaveform(): Promise<string | undefined> {
  const open = await openWaveforms();
  const uri = chooseDocument(open, waveformsOnScreen(open), chosenWaveform);
  if (uri !== chosenWaveform) {
    chosenWaveform = uri;
    trace(uri === undefined ? "  no waveform open" : `  using waveform ${uri}`);
    showWaveforms(open);
  }
  return uri;
}

/* What the schematic's picker shows. Sent on every change rather than asked
 * for, so the sidebar always names the dump the values came from -- and only
 * on a change, since the schematic re-reads its values whenever it is told. */
let lastShown = "";
function showWaveforms(open: string[], force = false): void {
  const state = { type: "ossschem/waveforms", documents: documentLabels(open), active: chosenWaveform };
  const shown = JSON.stringify(state);
  if (shown === lastShown && !force) {
    return;
  }
  lastShown = shown;
  for (const panel of panels) {
    void panel.webview.postMessage(state);
  }
}

/** The schematic's picker, used by hand: it stands until that dump is closed. */
async function useWaveform(uri: string): Promise<void> {
  const open = await openWaveforms();
  if (!open.includes(uri)) {
    trace(`  waveform ${uri} is no longer open`);
    showWaveforms(open);
    return;
  }
  chosenWaveform = uri;
  trace(`  waveform chosen by hand: ${uri}`);
  showWaveforms(open);
}

/** Waveforms opening and closing change what the picker should offer. */
async function refreshWaveforms(force = false): Promise<void> {
  const open = await openWaveforms();
  chosenWaveform = chooseDocument(open, waveformsOnScreen(open), chosenWaveform);
  showWaveforms(open, force);
}

/* vaporview accepts an add for a name it cannot resolve without complaining,
 * so a spelling that is merely wrong looks exactly like success. This asks
 * which spellings it actually knows: getValuesAtTime returns only those. */
async function diagnose(): Promise<void> {
  log?.show(true);
  const raw = await vscode.commands.executeCommand<unknown>("waveformViewer.getOpenDocuments").then(
    (r) => r, (e: unknown) => `error: ${String(e)}`);
  trace(`diagnose: getOpenDocuments -> ${JSON.stringify(raw)}`);
  const uri = await activeWaveform();
  trace(`diagnose: target document ${uri ?? "none"}`);
  if (uri === undefined || lastPicked.length === 0) {
    trace("  open a waveform and pick a signal in the schematic first");
    return;
  }
  const first = lastPicked[0];
  const candidates = pathCandidates(first);
  /* What vaporview already shows, named its own way. Add one signal from its
   * netlist tree by hand and this prints the spelling it uses for it, which
   * is the ground truth the probe has to match. */
  try {
    const state = await vscode.commands.executeCommand<unknown>("waveformViewer.getViewerState", { uri });
    const shown = JSON.stringify(state);
    trace(`  viewer state: ${shown.length > 2000 ? `${shown.slice(0, 2000)}…` : shown}`);
  } catch (err) {
    trace(`  could not read the viewer state: ${String(err)}`);
  }
  for (const candidate of candidates) {
    try {
      const values = await vscode.commands.executeCommand<{ instancePath: string; value: unknown }[]>(
        "waveformViewer.getValuesAtTime", { uri, instancePaths: [candidate] });
      const found = Array.isArray(values) && values.length > 0;
      trace(`  ${found ? "KNOWN  " : "unknown"} ${candidate}`
        + `${found ? ` = ${typeof values[0]?.value} ${JSON.stringify(values[0]?.value)}` : ""}`);
    } catch (err) {
      trace(`  error   ${candidate}: ${String(err)}`);
    }
  }
}

/* Ask the dump what it calls a signal before adding it.
 *
 * `addVariable` accepts a name it cannot resolve without complaining, so a
 * wrong spelling used to look exactly like success. `getValuesAtTime` answers
 * only for paths that exist, which makes it a usable existence check and lets
 * the probe survive a reader that names things differently.
 */
async function resolveInDump(uri: string, path: string[]): Promise<string | undefined> {
  for (const candidate of pathCandidates(path)) {
    try {
      const values = await vscode.commands.executeCommand<{ instancePath: string }[] | undefined>(
        "waveformViewer.getValuesAtTime", { uri, instancePaths: [candidate] });
      if (Array.isArray(values) && values.length > 0) {
        return candidate;
      }
    } catch {
      // try the next spelling
    }
  }
  return undefined;
}

/* Which elements of an unpacked array to add.
 *
 * A bundle of a few signals -- one per instance -- is almost always wanted
 * whole, while a memory almost never is, so the default follows the size and
 * Enter accepts it. Typing an index, a range or a list overrides it.
 */
async function chooseElements(paths: string[][]): Promise<string[][] | undefined> {
  const array = arrayShape(paths);
  if (array === undefined) {
    return paths;
  }
  const name = array.scope[array.scope.length - 1];
  const all = { label: `All ${array.indices.length} elements`, indices: array.indices };
  const first = { label: `First element · ${name}.[${array.indices[0]}]`, indices: [array.indices[0]] };
  const items = array.indices.length <= SMALL_ARRAY ? [all, first] : [first, all];

  const chosen = await new Promise<number[] | undefined>((resolve) => {
    const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { indices: number[] }>();
    pick.title = `Add ${name} to the waveform viewer`;
    pick.placeholder = "Enter to accept, or type an index, a range (0-7) or a list (0,2,5)";
    pick.items = items;
    pick.activeItems = [items[0]];
    let answered = false;
    pick.onDidAccept(() => {
      // typed text wins over the highlighted item, so a spec can be entered
      // without first clearing the filter
      const typed = parseIndexSpec(pick.value, array.indices);
      answered = true;
      resolve(typed ?? pick.selectedItems[0]?.indices ?? pick.activeItems[0]?.indices);
      pick.hide();
    });
    pick.onDidHide(() => {
      if (!answered) {
        resolve(undefined);
      }
      pick.dispose();
    });
    pick.show();
  });

  if (chosen === undefined) {
    trace("  cancelled");
    return undefined;
  }
  return chosen.map((i) => [...array.scope, `[${i}]`]);
}

/* Nothing to add to: say so where the user is looking, and offer the step
 * they would take next, since a dump is a file they have to open. */
async function noWaveformOpen(): Promise<void> {
  const open = "Open waveform\u2026";
  const answer = await vscode.window.showWarningMessage(
    "ossschem: no waveform is open in vaporview, so there is nowhere to add the signal.", open);
  if (answer === open) {
    await vscode.commands.executeCommand("workbench.action.files.openFile");
  }
}

async function sendToWaveform(offered: string[][]): Promise<void> {
  lastPicked = offered;
  const offeredText = offered.map((p) => p.join("."));
  trace(`schematic picked ${offered.length === 1 ? offeredText[0] : `${offered.length} signals: ${offeredText.join(", ")}`}`);
  if (!linkSelection) {
    trace("  skipped: link is turned off");
    return;
  }
  const viewer = vscode.extensions.getExtension(VAPORVIEW);
  if (viewer === undefined) {
    trace("  vaporview is not installed");
    if (!warnedNoViewer) {
      warnedNoViewer = true;
      void vscode.window.showInformationMessage(
        "ossschem: vaporview is not installed, so signals cannot be sent to a waveform.",
      );
    }
    return;
  }
  if (!viewer.isActive) {
    trace("  activating vaporview");
    await viewer.activate();
  }
  const uri = await activeWaveform();
  if (uri === undefined) {
    trace("  no waveform document is open");
    void noWaveformOpen();
    return;
  }
  trace(`  target document ${uri}`);

  // asked only once there is somewhere for the answer to go
  const chosen = await chooseElements(offered);
  if (chosen === undefined) {
    return;
  }
  if (chosen.length !== offered.length) {
    trace(`  adding ${chosen.length} of ${offered.length} elements`);
  }

  /* One call per signal. An array is addressed element by element rather than
   * by its scope, which is not something a viewer can plot. */
  let added = 0;
  const unresolved: string[] = [];
  for (const path of chosen) {
    const resolved = await resolveInDump(uri, path);
    if (resolved === undefined) {
      unresolved.push(path.join("."));
      continue;
    }
    if (resolved !== path.join(".")) {
      trace(`  ${path.join(".")} is called ${resolved} in this dump`);
    }
    try {
      await vscode.commands.executeCommand("waveformViewer.addVariable", { uri, instancePath: resolved, reveal: true });
      added++;
    } catch (err) {
      unresolved.push(`${resolved}: ${String(err)}`);
    }
  }
  trace(`  added ${added} of ${chosen.length} signal(s)`);
  if (unresolved.length === 0) {
    return;
  }
  trace(`  not in this dump:\n    ${unresolved.join("\n    ")}`);
  void vscode.window.showWarningMessage(
    `ossschem: ${unresolved.length} signal(s) are not in ${uri.split("/").pop() ?? "the dump"}. See the ossschem log.`,
  );
}

interface ValuesRequest {
  type: "ossschem/valuesRequest";
  id: number;
  instancePaths: string[][];
}

function isValuesRequest(message: unknown): message is ValuesRequest {
  const m = message as ValuesRequest | undefined;
  return m?.type === "ossschem/valuesRequest" && typeof m.id === "number" && Array.isArray(m.instancePaths);
}

/* Values at the cursor for whatever the schematic is showing. The viewer
 * answers only for names it knows, so anything it leaves out simply goes
 * unannotated. */
async function answerValues(panel: vscode.WebviewPanel, request: ValuesRequest): Promise<void> {
  const uri = await activeWaveform();
  const values: Record<string, string | string[]> = {};
  if (uri !== undefined && request.instancePaths.length > 0) {
    const paths = request.instancePaths.map((p) => p.join("."));
    try {
      const answered = await vscode.commands.executeCommand<{ instancePath: string; value: string | string[] }[]>(
        "waveformViewer.getValuesAtTime", { uri, instancePaths: paths });
      for (const entry of answered ?? []) {
        // handed over raw: only the schematic knows the width that says
        // whether a pair of entries is a transition or two bits
        values[entry.instancePath] = entry.value;
      }
      const sample = (answered ?? [])[0];
      if (sample !== undefined) {
        // the shape of this has differed from the documented one before
        trace(`  values: ${Object.keys(values).length} of ${paths.length}, e.g. ${sample.instancePath} = `
          + `${typeof sample.value} ${JSON.stringify(sample.value)}`);
      }
    } catch (err) {
      trace(`  values at the cursor failed: ${String(err)}`);
    }
  }
  void panel.webview.postMessage({ type: "ossschem/values", id: request.id, values });
}

interface VaporviewApi {
  onDidSetMarker?: (cb: () => void) => vscode.Disposable;
}

/* The cursor moving is worth following automatically; a selection changing is
 * not -- scrubbing the cursor moves the selection around, and a schematic that
 * jumps with it is worse than one that waits to be asked. Revealing is a
 * deliberate act, through the context menus vaporview lets us contribute to. */
async function listenToViewer(context: vscode.ExtensionContext): Promise<void> {
  if (listeningToViewer) {
    return;
  }
  const viewer = vscode.extensions.getExtension<VaporviewApi>(VAPORVIEW);
  if (viewer === undefined) {
    return;
  }
  if (!viewer.isActive) {
    await viewer.activate();
  }
  const api = viewer.exports;
  if (typeof api?.onDidSetMarker !== "function") {
    trace("vaporview exports no onDidSetMarker; values will not follow the cursor");
    return;
  }
  listeningToViewer = true;
  context.subscriptions.push(api.onDidSetMarker(() => {
    for (const panel of panels) {
      void panel.webview.postMessage({ type: "ossschem/cursorMoved" });
    }
  }));
  trace("following the cursor in vaporview");
}

/* Both of vaporview's menus hand over the signal in the same two pieces: the
 * scope it lives in and its own name. */
interface SignalContext {
  /** A string in the waveform context, an array in the netlist tree. */
  scopePath?: string | string[];
  signalName?: string;
  name?: string;
}

function scopeSegments(scopePath: string | string[] | undefined): string[] {
  const parts = Array.isArray(scopePath) ? scopePath : (scopePath ?? "").split(".");
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0);
}

function revealFromWaveform(target: SignalContext | undefined): void {
  const name = target?.signalName ?? target?.name;
  if (name === undefined || name === "") {
    void vscode.window.showWarningMessage("ossschem: no signal to reveal.");
    return;
  }
  const scope = scopeSegments(target?.scopePath);
  const instancePath = [...scope, name];
  trace(`reveal asked for ${instancePath.join(".")}`);
  if (panels.size === 0) {
    void vscode.window.showWarningMessage("ossschem: open a schematic first.");
    return;
  }
  for (const panel of panels) {
    void panel.webview.postMessage({ type: "ossschem/revealSignal", instancePath });
    panel.reveal(undefined, true);
  }
}

/** The editor the IR opens in, so a schematic is what a click on one gives. */
const SCHEMATIC_VIEW = "ossschem.schematic";

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

/** Fill a panel with the schematic for one IR file, however that panel was made. */
function mountSchematic(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, uri: vscode.Uri): void {
  const name = uri.path.split("/").pop() ?? "";
  const fail = (message: string): void => {
    trace(`  ${message}`);
    void vscode.window.showErrorMessage(`ossschem: ${message}`);
    panel.webview.html = `<!doctype html><meta charset="utf-8"><body style="font-family: sans-serif; padding: 2rem">`
      + `<p>ossschem: ${escapeHtml(message)}</p></body>`;
  };
  const viewerRoot = findViewer(context);
  if (viewerRoot === undefined) {
    fail("the viewer bundle is missing. Run `npm run build` in the ossschem checkout.");
    return;
  }
  let design: unknown;
  try {
    design = JSON.parse(readFileSync(uri.fsPath, "utf8"));
  } catch (err) {
    fail(`could not read ${name}: ${String(err)}`);
    return;
  }

  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(viewerRoot), vscode.Uri.file(dirname(uri.fsPath))],
  };
  trace(`opened ${name} with the viewer from ${viewerRoot}`);
  panels.add(panel);
  panel.onDidDispose(() => panels.delete(panel));
  // a waveform opening or closing changes what the picker offers, and can
  // retire the dump in use
  const tabs = vscode.window.tabGroups.onDidChangeTabs(() => { void refreshWaveforms(); });
  panel.onDidDispose(() => { tabs.dispose(); });
  void listenToViewer(context);
  panel.webview.onDidReceiveMessage(
    (message: unknown) => {
      const kind = (message as { type?: string } | undefined)?.type;
      if (kind === "ossschem/ready") {
        trace("webview connected");
        // the picker is empty until it is told, and it is told on connect
        void refreshWaveforms(true);
      } else if (kind === "ossschem/useWaveform") {
        void useWaveform(String((message as { uri?: unknown }).uri ?? ""));
      } else if (isValuesRequest(message)) {
        void answerValues(panel, message);
      } else if (isNetPicked(message)) {
        void sendToWaveform(message.instancePaths);
      } else {
        trace(`ignored a message from the webview: ${JSON.stringify(message)}`);
      }
    },
    undefined,
    context.subscriptions,
  );
  panel.webview.html = viewerHtml({
    indexHtml: readFileSync(join(viewerRoot, "index.html"), "utf8"),
    baseUri: panel.webview.asWebviewUri(vscode.Uri.file(viewerRoot)).toString(),
    cspSource: panel.webview.cspSource,
    nonce: randomBytes(16).toString("base64"),
    design,
    sources: readSources(uri.fsPath),
  });
}

/* A schematic IR is a drawing, not a document to read as text, so it opens as
 * one: VS Code hands the file to this editor, and `Reopen Editor With…` still
 * offers the text editor for the times the JSON itself is the question. */
class SchematicEditorProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => { /* the webview holds no handle on the file */ } };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    mountSchematic(this.context, panel, document.uri);
  }
}

/** The command, for a file that is already open as text or picked in the explorer. */
async function openSchematic(target?: vscode.Uri): Promise<void> {
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (uri === undefined) {
    void vscode.window.showErrorMessage("ossschem: open a schematic IR file first.");
    return;
  }
  const name = uri.path.split("/").pop() ?? "";
  if (!SCHEMATIC_IR.test(name)) {
    void vscode.window.showErrorMessage(
      `ossschem: ${name} is not a schematic IR. Expected schematic-ir.json or *.ir.json, as written by \`ossschem build\`.`,
    );
    return;
  }
  await vscode.commands.executeCommand("vscode.openWith", uri, SCHEMATIC_VIEW);
}

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("ossschem");
  context.subscriptions.push(
    log,
    vscode.window.registerCustomEditorProvider(SCHEMATIC_VIEW, new SchematicEditorProvider(context), {
      // the drawing is laid out on open, so keep it rather than redo it
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("ossschem.open", (target?: vscode.Uri) => {
      void openSchematic(target);
    }),
    vscode.commands.registerCommand("ossschem.revealFromWaveform", (target?: SignalContext) => {
      revealFromWaveform(target);
    }),
    vscode.commands.registerCommand("ossschem.diagnoseProbe", () => {
      void diagnose();
    }),
    vscode.commands.registerCommand("ossschem.showLog", () => {
      log?.show(true);
    }),
    vscode.commands.registerCommand("ossschem.linkWaveform", () => {
      linkSelection = !linkSelection;
      void vscode.window.showInformationMessage(
        `ossschem: selection ${linkSelection ? "linked to" : "unlinked from"} the waveform viewer.`,
      );
    }),
  );
}

export function deactivate(): void {
  // nothing to tear down: the panels own their own lifetime
}
