/** Groups per-machine clocks for display: [1.5, 1.5, 1, 1] -> [{ n: 2, clock: 1.5 }, { n: 2, clock: 1 }]. */
export function groupClocks(clocks: number[]): { n: number; clock: number }[] {
  const groups: { n: number; clock: number }[] = [];
  for (const c of clocks) {
    const last = groups.at(-1);
    if (last && Math.abs(last.clock - c) < 1e-6) last.n++;
    else groups.push({ n: 1, clock: c });
  }
  return groups;
}
