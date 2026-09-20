export class IdMint {
  private counts = new Map<string, number>();

  next(prefix: string): string {
    const n = this.counts.get(prefix) ?? 0;
    this.counts.set(prefix, n + 1);
    return `${prefix}${n}`;
  }
}
