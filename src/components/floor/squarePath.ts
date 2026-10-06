/** How round a belt's square turns are, in floor units. */
export const SQUARE_TURN = 12;

export type Pt = { x: number; y: number };

/**
 * A belt in straight runs with rounded square turns, from one end through its bends to the other. The ends are where
 * the cards draw them, so the first and last bends line up with them; with no bends it steps across half way. On a
 * floor running down the same holds turned a quarter: it leaves and reaches its ends going down.
 */
export function squarePath(from: Pt, bends: Pt[], to: Pt, down = false): { path: string; runs: [Pt, Pt][] } {
  // Worked out as if left to right, then turned back.
  const turn = (p: Pt) => (down ? { x: p.y, y: p.x } : { ...p });
  const [a0, b0] = [turn(from), turn(to)];
  const mid = bends.map(turn);
  if (mid.length >= 2) {
    mid[0].y = a0.y;
    mid[mid.length - 1].y = b0.y;
  } else if (mid.length === 0 && Math.abs(a0.y - b0.y) > 0.5) {
    const x = (a0.x + b0.x) / 2;
    mid.push({ x, y: a0.y }, { x, y: b0.y });
  }
  const pts = [a0, ...mid, b0]
    .map(turn)
    .filter((p, i, all) => i === 0 || Math.abs(p.x - all[i - 1].x) + Math.abs(p.y - all[i - 1].y) > 0.5);
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(SQUARE_TURN, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const k1 = r / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
    const k2 = r / (Math.hypot(c.x - b.x, c.y - b.y) || 1);
    d += ` L${b.x - (b.x - a.x) * k1},${b.y - (b.y - a.y) * k1} Q${b.x},${b.y} ${b.x + (c.x - b.x) * k2},${b.y + (c.y - b.y) * k2}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last.x},${last.y}`;
  return { path: d, runs: pts.slice(1).map((p, i) => [pts[i], p]) };
}

/** The middle of the longest straight run of a belt: where its label sits. */
export function longestRunMid(runs: [Pt, Pt][]): [number, number] {
  const [a, b] = runs.reduce((l, r) =>
    Math.hypot(r[1].x - r[0].x, r[1].y - r[0].y) > Math.hypot(l[1].x - l[0].x, l[1].y - l[0].y) ? r : l,
  );
  return [(a.x + b.x) / 2, (a.y + b.y) / 2];
}
