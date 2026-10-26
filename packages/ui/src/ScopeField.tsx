import { useEffect, useState, type ReactElement } from "react";
import type { DumpScope } from "./dump-scope.js";

/* Where the design sits in the waveform, under the waveform picker: shown so a
 * wrong guess is visible, and editable for the dump detection cannot place.
 * Emptying it hands the scope back to detection. */
export function ScopeField(props: { dumpScope: DumpScope; topName: string; disabled: boolean }): ReactElement {
  const { dumpScope, topName } = props;
  const shown = dumpScope.source === undefined ? "" : dumpScope.scope.join(".");
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);

  const commit = (): void => {
    const text = draft.trim();
    if (text === shown) {
      return;
    }
    dumpScope.setScope(text === "" ? undefined : text.split(".").filter((part) => part.length > 0));
  };
  const status = props.disabled ? undefined
    : dumpScope.found === false
      ? dumpScope.source === undefined
        ? `${topName} not found yet: select one of its signals in the waveform, or enter its scope`
        : `none of ${topName}'s ports are under this scope`
      : dumpScope.source === "auto" ? "found automatically" : undefined;

  return (
    <div className="ossschem-scope">
      <label className="ossschem-waveform">Scope
        <input type="text" value={draft} disabled={props.disabled} spellCheck={false}
          placeholder={`${topName} (as in the schematic)`}
          title={`The waveform's name for ${topName}, e.g. TOP.tb.u_dut. Empty finds it automatically.`}
          onChange={(ev) => { setDraft(ev.target.value); }}
          onBlur={commit}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              commit();
            } else if (ev.key === "Escape") {
              setDraft(shown);
            }
          }} />
      </label>
      {status !== undefined && (
        <p className={`ossschem-scope-status${dumpScope.found === false ? " ossschem-scope-missing" : ""}`} role="status">
          {status}
        </p>
      )}
    </div>
  );
}
