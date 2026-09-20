import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

const STORAGE_KEY = "ossschem.panel-sizes";
const DEFAULT = { left: 240, bottom: 240 };
const MIN = { left: 180, bottom: 120 };
type Side = "left" | "bottom";
type Sizes = Record<Side, number>;

function loadSizes(): Sizes {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Sizes | null;
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.bottom)) {
      return { left: Math.max(MIN.left, saved.left), bottom: Math.max(MIN.bottom, saved.bottom) };
    }
    const old = JSON.parse(localStorage.getItem("ossschem.sidebar-widths") ?? "null") as { left?: number } | null;
    if (old?.left !== undefined && Number.isFinite(old.left)) return { ...DEFAULT, left: Math.max(MIN.left, old.left) };
  } catch { /* Storage may be unavailable in embedded or private viewers. */ }
  return DEFAULT;
}

function Divider(props: {
  side: Side;
  size: number;
  max: number;
  onResize: (size: number) => void;
  onDragging: (active: boolean) => void;
}): ReactElement {
  const drag = useRef<{ start: number; size: number } | null>(null);
  const horizontal = props.side === "bottom";
  const name = horizontal ? "source pane" : "hierarchy sidebar";
  const resize = (size: number): void => props.onResize(Math.min(props.max, Math.max(MIN[props.side], size)));
  const finish = (): void => { drag.current = null; props.onDragging(false); };
  return (
    <div className={`ossschem-divider ossschem-divider-${props.side}`} role="separator" tabIndex={0} aria-label={`Resize ${name}`}
      aria-orientation={horizontal ? "horizontal" : "vertical"} aria-valuemin={MIN[props.side]} aria-valuemax={Math.round(props.max)}
      aria-valuenow={Math.round(props.size)} aria-valuetext={`${Math.round(props.size)} pixels`}
      title={`Drag to resize ${name}. Arrow keys adjust size; double-click or Enter resets it.`}
      onPointerDown={ev => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.currentTarget.focus();
        ev.currentTarget.setPointerCapture(ev.pointerId);
        drag.current = { start: horizontal ? ev.clientY : ev.clientX, size: props.size };
        props.onDragging(true);
      }}
      onPointerMove={ev => {
        if (drag.current) resize(drag.current.size + (horizontal ? drag.current.start - ev.clientY : ev.clientX - drag.current.start));
      }}
      onPointerUp={ev => {
        if (ev.currentTarget.hasPointerCapture(ev.pointerId)) ev.currentTarget.releasePointerCapture(ev.pointerId);
        finish();
      }}
      onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={() => resize(DEFAULT[props.side])}
      onKeyDown={ev => {
        const step = ev.shiftKey ? 40 : 10;
        if (ev.key === (horizontal ? "ArrowUp" : "ArrowRight")) resize(props.size + step);
        else if (ev.key === (horizontal ? "ArrowDown" : "ArrowLeft")) resize(props.size - step);
        else if (ev.key === "Home") resize(MIN[props.side]);
        else if (ev.key === "End") resize(props.max);
        else if (ev.key === "Enter") resize(DEFAULT[props.side]);
        else return;
        ev.preventDefault();
        ev.stopPropagation();
      }}
    />
  );
}

export function ResizablePanels(props: { left: ReactNode; bottom: ReactNode; children: ReactNode }): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState(loadSizes);
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState<Side | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = (): void => setContainer({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferred)); }
      catch { /* Resizing still works when preferences cannot be saved. */ }
    }, 150);
    return () => clearTimeout(timer);
  }, [preferred]);

  const max = { left: Math.max(MIN.left, container.width - 320 - 6), bottom: Math.max(MIN.bottom, container.height - 180 - 6) };
  const sizes = { left: Math.min(preferred.left, max.left), bottom: Math.min(preferred.bottom, max.bottom) };
  const divider = (side: Side): ReactElement => (
    <Divider side={side} size={sizes[side]} max={max[side]}
      onResize={size => setPreferred(previous => ({ ...previous, [side]: size }))}
      onDragging={active => setDragging(active ? side : null)} />
  );
  return (
    <div ref={host} className={`ossschem-body${dragging ? ` ossschem-resizing ossschem-resizing-${dragging}` : ""}`}
      style={{ "--left-sidebar-width": `${sizes.left}px`, "--source-pane-height": `${sizes.bottom}px` } as CSSProperties}>
      {props.left}
      {divider("left")}
      {props.children}
      {divider("bottom")}
      {props.bottom}
    </div>
  );
}
