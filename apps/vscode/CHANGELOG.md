# Changelog

## 0.9.0

- Cross probing works when the waveform dump names the design differently
  from the schematic: a design simulated under a SystemC or C++ harness, a
  cocotb wrapper or a SystemVerilog testbench sits one or more levels deeper in
  the dump, possibly under another instance name (`TOP.tb.u_dut`). The new
  **Scope** field under the sidebar's waveform picker holds the dump's name for
  the design's top, and **W**, **Values** and **Reveal in schematic** translate
  every name through it.
- The scope is usually found without asking: when a dump comes into use,
  ossschem checks the design's own names and Verilator's `TOP.<top>`, which
  every trace from a Verilator C++ harness uses; otherwise the first signal of
  the design selected or added in vaporview, or revealed in the schematic,
  tells it. A scope is only adopted once the dump confirms it, so a testbench
  wire named after one of the design's ports is not taken for the design.
- When detection cannot place the design, right-click its scope in vaporview's
  netlist tree and choose **Use as ossschem design root**, or type it into the
  Scope field. A scope given by hand is never replaced, and the field warns
  when the design is not found under it. Scopes are remembered per dump file
  and design.
- Revealing a waveform signal that is not part of the design, such as a
  testbench signal, now says so instead of doing nothing.
- `ossschem build` warns when it finds no source text for some of the design's
  files, as with JSON written in another checkout, and points to `--sources`.

## 0.8.0

- `ossschem build --json` builds the schematic from the JSON an existing
  `verilator --json-only` run already wrote, instead of running Verilator
  itself. The meta file defaults to `Vtop.tree.meta.json` beside the tree.
- Everything after `--` on the `ossschem build` command line goes to Verilator
  unchanged: parameter overrides (`-pvalue+NAME=value`), defines, include paths
  and `-f` file lists. A `--top-module` there replaces `--top`, and `--binary`
  and `--build`, which Verilator refuses alongside `--json-only`, are left out
  with a note.
- Verilator options placed before `--` are refused with a hint, rather than
  being taken for source file names.

## 0.7.0

- Fixes how a `case` statement is unrolled, and how the resulting muxes are
  drawn.

## 0.6.0

- Opens designs through VS Code's file system rather than node's, so a
  schematic can be read over a remote connection or in a repository browsed
  without cloning it. The webview no longer needs read access to the design's
  directory: the design and its sources are embedded in the page.
- Declares support for untrusted workspaces, so the extension is not disabled
  in Restricted Mode.

## 0.5.0

- Reads a register assigned across the branches of a `case` as the mux tree it
  is, rather than as one of the branches. A state machine's next-state logic —
  comparisons against the state constants, the branch values, and the hold
  feeding back from `Q` — is now drawn.
- Draws a constant that something reads, as a tie-off tag labelled with its
  value. A constant nothing reads, such as a shift amount the shifter already
  carries as a parameter, stays out of the drawing.
- Takes a register's reset value from the reset branch rather than from the
  first constant in the block, and recognises that branch whichever way
  Verilator folded the comparison.
- Names the nets crossing into an expanded box, which used to read as net ids.

## 0.4.0

- Banner and README artwork for the Marketplace listing.

## 0.3.0

- A schematic IR opens as a schematic: the extension is the default editor for
  `schematic-ir.json` and `*.ir.json`, with `Reopen Editor With…` for the JSON.
- The **Waveform** picker in the sidebar names the dump that everything reads
  and writes, and switches it when several are open. One dump serves adding
  signals, values at the cursor and the diagnostic.
- Values at the cursor are labelled per array element, light up with the
  selected signal, and are written out on the heading of the source pane.
- An unpacked array is drawn as one wire into a splitter with one branch per
  element, so an element can be selected, probed and valued on its own.
- **Reveal in schematic** opens the instances between the current scope and
  the signal in place, and frames it, rather than switching scope.
