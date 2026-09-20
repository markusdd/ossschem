# ossschem design

ossschem is an open-source RTL schematic tracer. It converts a Verilator JSON dump into a source-mapped schematic IR and presents that IR as an interactive, hierarchical SVG schematic. The viewer starts with process and assignment boxes, then exposes gates, registers, memories, and other primitives when the user expands or traces into a box.

This document describes the implementation that exists in this repository. It is a design reference, rather than the original build plan. The primary fixture is the asynchronous FIFO under `fixtures/svb_afifo/`.

## Current product surface

The standalone Vite application loads `schematic-ir.json` and the fixture sources. It provides:

- a full-height hierarchy sidebar;
- a schematic viewport with pan, wheel zoom, fit-to-view, and drag-to-rectangle zoom;
- a resizable world map with a viewport rectangle, click-to-center, drag-to-pan, and a toolbar visibility toggle;
- a source pane below the schematic whose height can be resized independently;
- a hierarchy sidebar whose width can be resized independently;
- process, assignment, instance, instance-array, primitive, and port selection;
- in-place structure and logic expansion, instance-array explosion, and explicit drill-in/back navigation;
- forward and backward signal tracing at container boundaries;
- independent inside and outside expansion handles on compound boundaries;
- isolation of a component or selected subtree;
- automatic fanout hiding with a user-configurable threshold;
- source declarations, expression text, drivers, and loads for selected ports, pins, and wires;
- bus widths, thicker multi-bit wires, and width markers;
- directional port glyphs and color-coded component families;
- selectable dark and light themes, with the dark theme as the default;
- branded About and Help screens, with the Help screen available from the toolbar or `H`;
- a probe-provider seam for future waveform cross-probing.

The browser UI is implemented in `packages/ui` and `packages/render`. The VS Code application in `apps/vscode` is a host skeleton: it accepts `.ir.json` as the intended input and creates a placeholder webview, but it is not yet a complete extension.

## Runtime architecture

The repository is a TypeScript workspace with these layers:

| Package | Responsibility |
| --- | --- |
| `packages/ir` | Serializable design model, source spans, widths, expression pretty-printing, stable serialization, and path-qualified view IDs. |
| `packages/ingest-verilator` | Parses Verilator tree/meta JSON, resolves addresses and dtypes, attaches source spans, discovers modules/ports/nets/boxes/instances, and lowers expressions into primitives. |
| `packages/cli` | Converts a tree/meta pair into Schematic IR. The fixture command regenerates `fixtures/svb_afifo/golden/schematic-ir.json`. |
| `packages/graph` | Builds the level-zero view graph, scoped connectivity, hierarchy model, tracing state, expansion state, isolation, fanout collapse, selection data, and handles. |
| `packages/layout` | Converts the view graph into an ELK layered orthogonal graph and maps ELK positions/routes back to view nodes and pins. |
| `packages/render` | Imperative SVG scene renderer, symbols, wire/bus drawing, hit-testing, camera controls, focus framing, rectangle zoom, and port outlines. |
| `packages/ui` | React application chrome, hierarchy, source pane, resizable panels, session commands, and the `SchematicPane` bridge to the imperative renderer. |
| `apps/web` | Vite demo shell. It fetches the fixture IR and imports fixture SystemVerilog sources as raw assets. |
| `apps/vscode` | Early extension-host/webview skeleton. |

React owns the toolbar, tree, source pane, and panel layout. The SVG root is managed imperatively because wires and nested nodes are more naturally updated as a scene than as thousands of React elements.

The current layout call runs ELK on the main thread with a timeout and a stale-generation guard in `SchematicPane`. The code is structured so a worker can be introduced later; it does not currently claim to run ELK in a worker.

## Input and Schematic IR

The supported product input is a pair produced by Verilator's `--json-only` mode: a tree JSON file and a companion metadata JSON file. The viewer itself consumes the resulting `.ir.json`; it does not parse Verilator tree/meta files in the browser.

The CLI performs this conversion:

```text
Verilator tree.json + meta.json
        │
        ▼
@ossschem/ingest-verilator
        │
        ▼
Design (schemaVersion: 1)
        │
        ▼
schematic-ir.json
```

The top-level IR is:

```ts
interface Design {
  schemaVersion: 1;
  top: Id;
  modules: Record<Id, Module>;
  files: Record<string, { path: string; language: string }>;
  meta: {
    producer: "verilator-json-only";
    verilatorVersion: string;
    dumpedAt: string;
  };
}
```

Each `Module` contains parameters, ports, nets, named process/assignment boxes, and instances. IDs are module-local. A `ViewId` adds the instance path to an IR ID, and `viewIdKey` serializes it as a path followed by `#` and the IR ID. Canvas data IDs, trace keys, selection keys, and future probe keys use these path-qualified IDs so repeated module instances cannot collide.

Ports have `input`, `output`, or `inout` direction, a net reference, and a source span. Nets retain their name, scalar or packed width, kind (`port`, `reg`, `wire`, or `memory`), optional memory depth, source span, and driver/load endpoints. Endpoint records preserve whether the endpoint belongs to a box, port, or constant and retain bit ranges when available.

`AlwaysBox` records its keyword, clocks, resets, external ports, source span, and a `PrimitiveGraph`. `AssignBox` has the same external and primitive structure without clock/reset metadata. Primitive graphs contain lowered cells and local nets. The supported primitive kinds include:

```text
dff, adff, dffe, adffe
mux, and, or, xor, not, eq, add
shiftr, shiftl, concat, slice, extend
memrd, memwr, buf, const, opaque
```

An unsupported lowering case becomes an `opaque` primitive with its Verilator AST type and source location. This preserves the surrounding graph and gives the source/expression pane something useful to report.

The Verilator ingest path indexes addresses before resolving pointer fields, resolves dtypes and packed ranges, records source locations through the metadata file, and attaches port/instance usedef endpoints after module discovery. Expression lowering recognizes variable references, constants, selects, array selects, concatenations, unary/binary operations, and sequential assignments. Sequential lowering recognizes clocks and resets from sensitivity metadata rather than signal names and classifies register logic into DFF/ADFF/DFFE/ADFFE forms where the shape is understood.

Source spans are intentionally kept separate from the elaborated expression graph. A Verilator reference can point to a declaration rather than a use site, so selection code prefers a valid declaration span, then a temporary-net span, producer span, or enclosing box span. The schematic therefore represents elaborated logic while the source pane shows original RTL.

## View graph and session state

`buildLevel0` converts a module into top-level `Level0Node`s:

- primary input ports are placed on the left;
- primary output and inout ports are placed on the right;
- always and assign boxes occupy the middle;
- instances and instance arrays occupy the middle;
- primitive children are materialized only when their containing box is expanded.

`Level0Node` includes a title, kind, optional badge/symbol, geometry, pins, optional children, and optional interior edges. A `Level0Edge` identifies source and target nodes and pins, net name/ID, width, and whether it is stubbed. Primitive symbol geometry and port positions are mapped from a common 80×64 symbol coordinate system.

`ViewSession` is the exploration state:

```ts
interface ViewSession {
  moduleId: string;
  path: string[];
  exploded: Set<string>;
  expansion: Set<string>;
  fanoutLimit?: number;
  visible?: Set<string>;
  revealedEdges?: Set<string>;
  hiddenEdges?: Set<string>;
  partial?: Map<string, Set<string>>;
}
```

`expansion` opens a process, assignment, or instance in place. `exploded` replaces an instance array with its member instances. `partial` records children revealed by a directional trace without opening every child. `visible` is used for isolation. `revealedEdges` overrides automatic fanout stubbing for explicitly traced routes. `hiddenEdges` records a user-collapsed individual branch. Sessions are copied before mutation and have a stable identity string for view comparisons.

The hierarchy tree is structural and independent of current canvas visibility. It includes a selectable module root, primary ports, boxes, arrays, array members, and nested module structure. `Expand structure` opens instance structure beneath the selection. `Expand logic` additionally opens all always/assign boxes in that subtree. Both operations are additive. `Collapse` removes expansion or explosion state for a component; when a wire is selected it hides only that wire branch and restores its endpoint handles.

## Connectivity, fanout, and tracing

`buildLevel0Connectivity` constructs scoped connectivity for the current module occurrence. Internal net IDs are prefixed by the session path. Expanded instances recursively build their child module graph, then alias child boundary ports to the parent instance pins. Interior edges remain attached to the containing compound node.

The outer module applies two automatic hiding rules:

1. clocks and asynchronous resets discovered from always-box sensitivity data are stubbed;
2. any net whose local load fanout reaches the session's `fanoutLimit` is stubbed.

The default fanout limit is 8 loads. A limit of 0 disables ordinary fanout hiding. The toolbar stores the value locally. Expanded instances use their own local fanout count, so a clock/reset hidden at the outer module can still be drawn inside an instance when its local fanout is small.

Stubbed edges are omitted from the drawn edge list, but the nodes and pins remain. Pins receive independent `inside` and `outside` handle state. This makes it possible to trace into a compound while leaving its external branch collapsed, or trace out of it while leaving its internal branch collapsed. A collapsed wire branch is hidden through `hiddenEdges`, without removing sibling branches.

Tracing uses `hopAtBoundary` and `revealTrace`. A selected node, pin, or wire is followed in the requested direction until the next meaningful boundary. An inside trace can partially open a process or instance and add only the relevant child branch. An outside trace can reveal neighboring module nodes without opening the selected compound. Explicit expansion remains the way to display the complete contents.

The source pane also lists drivers and loads for a selected signal. `revealSignalConnection` walks the selected signal's local graph to a chosen endpoint and reveals only that route. Expanded boundaries are treated as pass-through connections in the endpoint list rather than being reported as duplicate drivers or loads.

## Layout

`packages/layout` translates nodes and edges into ELK's layered, right-facing, orthogonal graph. ELK uses fixed port sides and local compound padding. Process/instance compounds receive larger top and bottom margins so labels and low ports clear their boundaries. Primitive nodes use fixed symbol dimensions and the graph's symbol-port map.

After ELK returns, the adapter:

1. applies nested positions to the corresponding `Level0Node`s;
2. remaps compound and primitive pin coordinates;
3. aligns all primary input connection tips and all output/inout connection points even when a wire is hidden;
4. collects nested edge sections;
5. slides route endpoints from node borders onto the actual drawn pin/glyph coordinates;
6. falls back to orthogonal H/V routing when ELK has no route.

Each layout request has a timeout. If it fails, the caller can keep the naive/current scene rather than blanking the canvas. `SchematicPane` ignores stale layout generations so an older request cannot overwrite a newer expansion.

## Rendering and symbols

The renderer draws a single SVG world with a camera transform. Wires have transparent hit paths plus visible paths. Multi-bit wires use a thicker stroke and a slash/count marker. Labels are positioned with obstacle and wire clearances. Selecting a wire selects its net and highlights related pins and wires.

The world map is a separate canvas overview of the current laid-out scene. It caches simplified component rectangles and wire routes, with a DOM rectangle marking the current viewport. Scene subscriptions rebuild its absolute node positions and bounds only when the scene changes; theme or map-size changes repaint the cached geometry. Camera updates move only the viewport rectangle, coalesced through `requestAnimationFrame`. Map navigation updates the existing camera translation without selecting, expanding, or invoking layout. The map's bounds include routed wires and remain fixed during navigation.

The map sits at the bottom right of the schematic. Its upper-left resize handle preserves the panel aspect ratio; the entire panel is capped at 30% of the schematic viewport area and constrained to fit the available width and height. A resize observer reapplies those limits when the viewport changes. Width and toolbar visibility preferences are stored locally. Hiding the map detaches its subscriptions, observer, and pending animation frame; showing it recreates the overview from the current scene.

Component families use CSS variables:

| Family | Color family |
| --- | --- |
| Ports | blue |
| Always/assign boxes | green |
| Instances/arrays | purple |
| Primitive symbols | amber |

The toolbar theme selector uses the current dark palette by default and offers a light counterpart with the same family colors and interaction contrast. The selected theme is persisted in browser local storage. The CSS variables are scoped through `data-theme`, leaving room for additional named themes without changing the renderer.

Selected/cone-highlighted nodes retain their family color in the fill, border, header, and primitive symbol stroke. The border uses a non-scaling SVG stroke so the highlight remains visible when zoomed out.

Port glyphs indicate direction. Inputs have a right-facing point where the wire enters, outputs have the connection on their left side while their body points right, and inouts have points on both ends. Inputs and outputs are aligned by their connection tips rather than by their variable-length labels.

The symbol renderer includes gates, buffers, muxes, arithmetic/comparison blocks, slices, concatenations, memory read/write blocks, and standard DFF variants. Flip-flop control/data labels share the same evenly spaced pin definition used by graph placement; the clock triangle is at the lower left, reset is above data, enable is between data and clock, and Q is on the right. Memory captions are placed below the actual glyph rather than below the letterboxed node box.

## Navigation and interaction

The canvas supports:

- click: select a node, pin, label, or wire;
- double-click / `E`: expand a process or instance, or explode an instance array;
- `L`: expand logic beneath the selected component;
- `Enter`: drill into an instance;
- `Backspace` / Back: return from a drilled module;
- `B` / `F`: trace backward/forward;
- `Shift+B` / `Shift+F`: trace through the selected boundary;
- `C` / Collapse: collapse a selected compound or individual wire;
- `I` / Isolate: isolate the selected component;
- `Escape`: clear tracing/selection or cancel a gesture;
- `H`: toggle the shortcut and operations Help screen; the logo opens About;
- middle-drag, Alt-drag, or Space-drag: pan;
- wheel: zoom around the pointer;
- left-drag on empty canvas or empty compound space: zoom to a rectangle;
- Fit: frame the complete current scene.

Trace and expansion actions request a focused camera frame around the origin, destination, and nearby context. Explicit whole-module expansion may fit the complete result; local expansion does not unexpectedly zoom out to the full design.

The hierarchy sidebar and source pane are resizable. Sizes are persisted in browser local storage. The source pane displays declarations or expression source, line numbers, highlighted spans, reconstructed expressions, and driver/load controls. `ProbeProvider` is currently a null interface; waveform value annotation and cross-probing are future integrations.

## Fixture and validation

The checked-in fixture contains:

```text
fixtures/svb_afifo/src/
fixtures/svb_afifo/verilator/
fixtures/svb_afifo/golden/schematic-ir.json
fixtures/svb_afifo/manifest.json
```

The fixture exercises 12 top-level ports, named sequential and combinational processes, continuous assignments, generate-loop synchronizer arrays, memories, bit selects, concatenations, gray-code arithmetic, clocks, and asynchronous resets. `scripts/dump-verilator.mjs` regenerates the raw Verilator files when Verilator is available. The CLI fixture command regenerates the golden IR from those files. Normal CI tests use the checked-in JSON and do not require Verilator.

The tests cover:

- Verilator parsing, pointer/dtype/source-span handling, and lowering;
- module/port/net/box/instance IR construction;
- path-qualified IDs and nested instance expansion;
- local and partial connectivity, fanout, collapsed clocks/resets, and hidden wire branches;
- directional handles and tracing;
- source declarations, temporary expressions, drivers, and loads;
- bus widths and scalar slices;
- memory output pin attachment and symbol port geometry;
- ELK routing, nested compounds, port alignment, and orthogonality;
- focus framing, rectangle zoom, reverse drag direction, Escape cancellation, and panning.

Useful commands from the repository root are:

```text
npm install
npm test
npm run typecheck
npm exec vitest run
npm run build
npm run dev
npm run fixture:dump
npm run ossschem -- dump --fixture svb_afifo
```

## Boundaries and future work

The current implementation deliberately does not provide:

- a finished VS Code webview or Marketplace package;
- waveform loading, value annotation, or VaporView cross-probing;
- RTL editing or round-tripping;
- Yosys, GHDL, slang, or other frontend adapters;
- a worker-based ELK pipeline;
- viewport virtualization for very large scenes;
- a completed net search field (the toolbar control is present but disabled).

These are extension points, not assumptions embedded in the current graph model. Future frontends should emit the same Schematic IR. Future waveform providers should use path-qualified view IDs and the existing probe interface. A worker or alternate renderer should preserve the `LaidOut` and `CanvasScene` boundaries. Large-design optimization can add viewport culling, worker layout, and more selective graph materialization without changing the source-mapped IR.

## Security and data handling

An IR file contains source locations and can be accompanied by source text. Treat it as source-code-equivalent when sharing it. The current viewer is local and has no telemetry or account service. The fixture and documentation use repository-relative paths; generated IR may still contain source paths supplied by the Verilator metadata and should be sanitized when distributing a design.
