import type { Net } from "@ossschem/ir";

type NetRef = { net: string; bits?: { msb: number; lsb: number } };

/** Use the selected slice, not the width of its containing bus. */
export function referenceWidth(ref: NetRef, nets: Net[]): number | undefined {
  const range = ref.bits ?? nets.find(n => n.id === ref.net)?.width;
  return range ? Math.abs(range.msb - range.lsb) + 1 : undefined;
}

/** A folded generate array represents the union of its members' connections. */
export function combinedWidth(refs: NetRef[], nets: Net[]): number | undefined {
  const ranges = refs.map(ref => ref.bits ?? nets.find(n => n.id === ref.net)?.width);
  if (!ranges.length || ranges.some(r => r === undefined)) return undefined;
  const intervals = ranges.map(r => [Math.min(r!.msb, r!.lsb), Math.max(r!.msb, r!.lsb)]).sort((a, b) => a[0] - b[0]);
  let count = 0;
  let end = -Infinity;
  for (const [lo, hi] of intervals) {
    count += Math.max(0, hi - Math.max(lo, end + 1) + 1);
    end = Math.max(end, hi);
  }
  return count;
}

export function connectionWidth(source?: number, target?: number): number | undefined {
  return source === undefined ? target : target === undefined ? source : Math.min(source, target);
}
