/** Inputs and outputs point along data flow; inouts have a tip at each end. */
export function portOutline(width: number, height: number, bidirectional: boolean, pinY = height / 2): string {
  const tip = Math.min(18, width / 4);
  return bidirectional
    ? `M0,${pinY} L${tip},0 H${width - tip} L${width},${pinY} L${width - tip},${height} H${tip} Z`
    : `M0,0 H${width - tip} L${width},${pinY} L${width - tip},${height} H0 Z`;
}
