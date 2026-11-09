import { useT } from '../../lib/i18n';

// A pixel heart on a 9 × 8 grid: X outline, R fill, W shine.
const HEART = ['.XXX.XXX.', 'XRWRXRRRX', 'XRRRRRRRX', 'XRRRRRRRX', '.XRRRRRX.', '..XRRRX..', '...XRX...', '....X....'];
const COLOR = { X: '#1a0000', R: '#e8191c', W: '#ff9a9a', E: '#4a4a4a' } as const;

/** The heart's pixels as one path per colour. A half heart keeps its left half red; the rest is the empty container. */
function paths(half: boolean) {
  const by: Record<string, string> = {};
  HEART.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (c === '.') return;
      const key = half && x > 4 && c !== 'X' ? 'E' : c;
      by[key] = `${by[key] ?? ''}M${x} ${y}h1v1h-1z`;
    });
  });
  return Object.entries(by).map(([key, d]) => <path key={key} d={d} fill={COLOR[key as keyof typeof COLOR]} />);
}
const FULL = paths(false);
const HALF = paths(true);

/** Health as Minecraft hearts, ten HP a heart (the player's 100 is a row of ten), and the plain number beside them. */
export function Health({ hp }: { hp: number }) {
  const { t, num } = useT();
  const halves = Math.max(1, Math.round(hp / 5));
  return (
    <span className="health">
      <span className="hearts" role="img" aria-label={t('healthN', { n: num(hp) })}>
        {Array.from({ length: Math.ceil(halves / 2) }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the hearts never reorder
          <svg key={i} viewBox="0 0 9 8" shapeRendering="crispEdges" aria-hidden>
            {i * 2 + 1 === halves ? HALF : FULL}
          </svg>
        ))}
      </span>
      <span className="health-n">{num(hp)}</span>
    </span>
  );
}
