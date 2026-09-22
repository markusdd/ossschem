import { useEffect, useRef, type ReactElement } from "react";
import { buildVisibleConnectivity, hopAtBoundary, type PinFace, type TraceDirection, type Level0Node, type ViewSession } from "@ossschem/graph";
import type { Design } from "@ossschem/ir";
import { fromElkGraph, layoutLevel0 } from "@ossschem/layout";
import { attachCanvas, attachMinimap, mountSchematicSvg, traceFocusKeys, type CanvasController } from "@ossschem/render";

export interface ViewportRequest { key: string; direction?: TraceDirection; keys?: string[]; fit?: boolean }

function applyViewport(ctl: CanvasController, request: ViewportRequest): void {
  if (request.fit) {
    ctl.zoomToFit();
    return;
  }
  ctl.focusElements(request.keys === undefined ? [request.key] : traceFocusKeys(ctl.scene().nodes, request.keys));
}

export function SchematicPane(props: {
  design: Design | null;
  session: ViewSession | null;
  selectedKey: string | null;
  viewportRequest?: ViewportRequest | null;
  showWorldMap?: boolean;
  theme?: string;
  onSelect: (key: string | null) => void;
  onDblClick: (key: string) => void;
  onTracePin: (key: string, direction: TraceDirection, face?: PinFace) => void;
  onReady?: (ctl: CanvasController) => void;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctlRef = useRef<CanvasController | null>(null);
  const minimapRef = useRef<ReturnType<typeof attachMinimap> | null>(null);
  const genRef = useRef(0);
  const previousRef = useRef<{ design: Design; session: ViewSession; keys: Set<string> } | null>(null);
  const requestRef = useRef<ViewportRequest | null | undefined>(null);

  /* A request can name something that exists only once the scene does -- a
   * reveal learns its wire from the rebuilt graph -- so it is kept for the
   * layout in flight, and applied here when the scene is already settled. */
  useEffect(() => {
    requestRef.current = props.viewportRequest;
    const ctl = ctlRef.current;
    const request = props.viewportRequest;
    if (ctl === null || request === null || request === undefined ||
        previousRef.current?.session !== props.session) {
      return;
    }
    applyViewport(ctl, request);
  }, [props.viewportRequest, props.session]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    const svg = mountSchematicSvg(host);
    const ctl = attachCanvas(svg);
    ctlRef.current = ctl;
    props.onReady?.(ctl);
  }, [props.onReady]);

  useEffect(() => {
    if (!props.showWorldMap || !hostRef.current || !ctlRef.current) return;
    const minimap = attachMinimap(hostRef.current, ctlRef.current);
    minimapRef.current = minimap;
    return () => { minimap.destroy(); minimapRef.current = null; };
  }, [props.showWorldMap, props.onReady]);

  useEffect(() => { minimapRef.current?.refreshTheme(); }, [props.theme]);

  useEffect(() => {
    const ctl = ctlRef.current;
    if (ctl === null) {
      return;
    }
    ctl.onSelect = props.onSelect;
    ctl.onDblClick = props.onDblClick;
    ctl.onTracePin = props.onTracePin;
    ctl.setSelection(props.selectedKey);
  }, [props.onSelect, props.onDblClick, props.onTracePin, props.selectedKey]);

  useEffect(() => {
    const ctl = ctlRef.current;
    if (ctl === null) {
      return;
    }
    if (props.design === null || props.session === null) {
      return;
    }
    const design = props.design;
    const session = props.session;
    const previous = previousRef.current;
    const sameView = previous?.design === design && previous.session.moduleId === session.moduleId &&
      previous.session.path.join("/") === session.path.join("/");
    const conn = buildVisibleConnectivity(design, session);
    const allKeys = (nodes: Level0Node[]): string[] => nodes.flatMap(n => [n.key, ...allKeys(n.children ?? [])]);
    const keys = new Set(allKeys(conn.nodes));
    const focusKeys = sameView ? [
      ...[...session.expansion].filter(key => !previous.session.expansion.has(key)),
      ...[...previous.session.expansion].filter(key => !session.expansion.has(key) && keys.has(key)),
      ...[...previous.session.exploded].filter(key => !session.exploded.has(key) && keys.has(key)),
    ] : [];
    if (sameView && focusKeys.length === 0 && [...session.exploded].some(key => !previous.session.exploded.has(key))) {
      focusKeys.push(...[...keys].filter(key => !previous.keys.has(key)));
    }
    // Keep the existing scene and camera while an in-place expansion is laying out.
    if (!sameView) {
      const naive = fromElkGraph({ id: "root", children: [], edges: [] }, conn.nodes, conn.edges);
      ctl.setScene({ nodes: naive.nodes, wires: naive.edges, collapsed: conn.collapsed, junctions: naive.junctions });
      ctl.zoomToFit();
    }
    const gen = ++genRef.current;
    void layoutLevel0(conn.nodes, conn.edges)
      .then((laid) => {
        if (gen !== genRef.current) {
          return;
        }
        ctl.setScene({
          nodes: laid.nodes,
          wires: laid.edges,
          collapsed: conn.collapsed,
          junctions: laid.junctions,
        });
        previousRef.current = { design, session, keys };
        // whatever was asked for last, including while this layout ran
        const request = requestRef.current;
        if (!sameView || request?.fit) ctl.zoomToFit();
        else if (request?.keys) ctl.focusElements(traceFocusKeys(laid.nodes, request.keys));
        else if (request?.direction) {
          const progress = session.trace;
          const trace = progress?.origin === request.key && progress.direction === request.direction
            ? progress.focus : hopAtBoundary(design, request.key, request.direction, session);
          const added = [...keys].filter(k => !previous.keys.has(k));
          ctl.focusElements(traceFocusKeys(laid.nodes, [...trace, ...added]));
        }
        // a wire is not a node, but it is still something to frame
        else if (request && (keys.has(request.key) || laid.edges.some(e => e.key === request.key))) {
          ctl.focusElements([request.key]);
        }
        else if (focusKeys.length > 0) ctl.focusElements(focusKeys);
        else if ([...keys].some(k => !previous.keys.has(k)) || [...previous.keys].some(k => !keys.has(k))) ctl.zoomToFit();
      })
      .catch(() => {
        /* naive scene already on screen */
      });
    return () => { genRef.current += 1; };
  }, [props.design, props.session, props.onReady]);

  return <div ref={hostRef} className="ossschem-schematic-host" />;
}
