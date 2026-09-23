# Changelog

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
