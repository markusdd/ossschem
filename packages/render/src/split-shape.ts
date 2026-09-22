/** A bus ripper: narrow where the array arrives, full height where its elements leave. */
export function splitOutline(width: number, height: number, fanOut: boolean): string {
  const neck = 6;
  return fanOut
    ? `M0,${height / 2 - neck} L${width},0 V${height} L0,${height / 2 + neck} Z`
    : `M${width},${height / 2 - neck} L0,0 V${height} L${width},${height / 2 + neck} Z`;
}
