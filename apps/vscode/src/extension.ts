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

import { arrayShape, parseIndexSpec, pathCandidates, pickDocument, SMALL_ARRAY,
  type OpenDocuments } from "./vaporview.js";
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

/** Selection is forwarded to the waveform viewer unless the user turns it off. */
let linkSelection = true;
let warnedNoViewer = false;
/* Cross probing depends on another extension, so every step is logged: silent
 * failure here is indistinguishable from "nothing happened". */
let log: vscode.OutputChannel | undefined;
/** The last thing the schematic offered, for the diagnostic command. */
let lastPicked: string[][] = [];
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
/** The waveform the signals should go to, asked of vaporview rather than assumed. */
async function activeWaveform(): Promise<string | undefined> {
  try {
    const open = await vscode.commands.executeCommand<OpenDocuments>("waveformViewer.getOpenDocuments");
    const uri = pickDocument(open);
    if (uri === undefined) {
      trace(`  vaporview reports no open waveform: ${JSON.stringify(open)}`);
    } else if (Array.isArray(open) && open.length > 1) {
      trace(`  ${open.length} waveforms open, using the first`);
    }
    return uri;
  } catch (err) {
    trace(`  could not ask vaporview for its documents: ${String(err)}`);
    return undefined;
  }
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
      trace(`  ${found ? "KNOWN  " : "unknown"} ${candidate}${found ? ` = ${JSON.stringify(values[0]?.value)}` : ""}`);
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
    void vscode.window.showWarningMessage("ossschem: open a waveform in vaporview first.");
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

interface SelectSignalEvent {
  instancePath?: unknown;
}

interface VaporviewApi {
  onDidSelectSignal?: (cb: (event: SelectSignalEvent) => void) => vscode.Disposable;
}

/* The reverse direction: a signal selected in the waveform is shown in the
 * schematic. Subscribed once, when the first schematic opens, because
 * vaporview may not be running before that. */
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
  if (typeof api?.onDidSelectSignal !== "function") {
    trace("vaporview exports no onDidSelectSignal; waveform to schematic is off");
    return;
  }
  listeningToViewer = true;
  context.subscriptions.push(
    api.onDidSelectSignal((event) => {
      // the event carries every selected signal; the first is the one to show
      const raw = Array.isArray(event.instancePath) ? event.instancePath : [event.instancePath];
      const first = raw.find((p): p is string => typeof p === "string" && p.length > 0);
      if (first === undefined || panels.size === 0) {
        return;
      }
      trace(`waveform selected ${first}`);
      for (const panel of panels) {
        void panel.webview.postMessage({ type: "ossschem/revealSignal", instancePath: first.split(".") });
      }
    }),
  );
  trace("listening for selections in vaporview");
}

async function openSchematic(context: vscode.ExtensionContext, target?: vscode.Uri): Promise<void> {
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

  const viewerRoot = findViewer(context);
  if (viewerRoot === undefined) {
    void vscode.window.showErrorMessage(
      "ossschem: the viewer bundle is missing. Run `npm run build` in the ossschem checkout.",
    );
    return;
  }

  let design: unknown;
  try {
    design = JSON.parse(readFileSync(uri.fsPath, "utf8"));
  } catch (err) {
    void vscode.window.showErrorMessage(`ossschem: could not read ${name}: ${String(err)}`);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "ossschem.schematic",
    `ossschem — ${name}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      // the drawing is laid out on open, so keep it rather than redo it
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(viewerRoot), vscode.Uri.file(dirname(uri.fsPath))],
    },
  );
  trace(`opened ${name} with the viewer from ${viewerRoot}`);
  panels.add(panel);
  panel.onDidDispose(() => panels.delete(panel));
  void listenToViewer(context);
  panel.webview.onDidReceiveMessage(
    (message: unknown) => {
      if ((message as { type?: string } | undefined)?.type === "ossschem/ready") {
        trace("webview connected");
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

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("ossschem");
  context.subscriptions.push(
    log,
    vscode.commands.registerCommand("ossschem.open", (target?: vscode.Uri) => {
      void openSchematic(context, target);
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
