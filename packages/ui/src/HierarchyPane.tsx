import { useState, type ReactElement, type ReactNode } from "react";
import type { HierarchyItem } from "@ossschem/graph";

function Branch(props: {
  item: HierarchyItem;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onExpand: (key: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { item } = props;
  const expandable = ["always", "assign", "instance", "instanceArray"].includes(item.kind);
  return (
    <li>
      <div className={`ossschem-tree-row ossschem-kind-${item.kind}`}>
        {item.children.length > 0 ? (
          <button className="ossschem-tree-toggle" type="button" aria-label={`${open ? "Hide" : "Browse"} ${item.title}`} aria-expanded={open}
            onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button>
        ) : <span className="ossschem-tree-toggle" />}
        <span className="ossschem-kind-dot" aria-hidden="true" />
        <button type="button" className="ossschem-tree-select" title={`${item.title}${item.detail ? ` · ${item.detail}` : ""}`}
          aria-pressed={props.selectedKey === item.key} onClick={() => props.onSelect(item.key)}
          onDoubleClick={() => { if (expandable) props.onExpand(item.key); }}>
          {item.title}
        </button>
      </div>
      {open && <ul>{item.children.map(child => <Branch key={child.key} {...props} item={child} />)}</ul>}
    </li>
  );
}

export function HierarchyPane(props: {
  /** The waveform picker, when there is a host with waveforms to offer. */
  waveform?: ReactNode;
  moduleName?: string;
  moduleKey?: string;
  items: HierarchyItem[];
  selectedKey: string | null;
  canIsolate: boolean;
  canExpand: boolean;
  canExpandStructure: boolean;
  canCollapse: boolean;
  onSelect: (key: string) => void;
  onExpand: (key: string) => void;
  onExpandStructure: () => void;
  onExpandLogic: () => void;
  onIsolate: () => void;
  onCollapse: () => void;
}): ReactElement {
  return (
    <aside className="ossschem-hierarchy" aria-label="Hierarchy">
      <div className="ossschem-hierarchy-actions">
        {props.waveform}
        <h2>Hierarchy</h2>
        <div className="ossschem-selection-actions">
          <button type="button" onClick={props.onIsolate} disabled={!props.canIsolate}>Isolate</button>
          <button type="button" onClick={props.onExpandStructure} disabled={!props.canExpandStructure}>Expand structure</button>
          <button type="button" onClick={props.onExpandLogic} disabled={!props.canExpand}>Expand logic</button>
          <button type="button" onClick={props.onCollapse} disabled={!props.canCollapse}>Collapse</button>
        </div>
        <div className="ossschem-legend" aria-label="Component colors">
          <span className="ossschem-kind-port"><i className="ossschem-kind-dot" />Ports</span>
          <span className="ossschem-kind-always"><i className="ossschem-kind-dot" />Processes</span>
          <span className="ossschem-kind-instance"><i className="ossschem-kind-dot" />Instances</span>
        </div>
      </div>
      {!props.moduleName ? <p className="ossschem-muted">No design loaded.</p> : (
        <ul className="ossschem-tree">
          <li><button type="button" className="ossschem-tree-select ossschem-tree-root"
            aria-pressed={props.selectedKey === props.moduleKey}
            onClick={() => props.moduleKey && props.onSelect(props.moduleKey)}>{props.moduleName}</button><ul>
            {props.items.map(item => <Branch key={item.key} item={item} selectedKey={props.selectedKey} onSelect={props.onSelect} onExpand={props.onExpand} />)}
          </ul></li>
        </ul>
      )}
    </aside>
  );
}
