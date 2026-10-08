import { balancerFor } from '../lib/balancer';
import { useT } from '../lib/i18n';

const GAP = 22;
const LEVEL = 26;

/** The tree as small circles: one belt in, split stage by stage into one per machine. */
function Tree({ stages }: { stages: number[] }) {
  // Every level's x positions: the machines spread evenly, each splitter over the middle of its branches.
  const leaves = stages.reduce((a, b) => a * b, 1);
  let xs = Array.from({ length: leaves }, (_, i) => i * GAP);
  const levels: number[][] = [xs];
  for (const s of [...stages].reverse()) {
    xs = Array.from({ length: xs.length / s }, (_, i) => xs.slice(i * s, i * s + s).reduce((a, b) => a + b, 0) / s);
    levels.unshift(xs);
  }
  const width = (leaves - 1) * GAP + 16;
  // Each level's branches as lines from a splitter to the ones under it, and the splitters themselves as dots.
  const lines = levels
    .slice(0, -1)
    .flatMap((row, l) =>
      row.flatMap((x, i) =>
        levels[l + 1]
          .slice(i * stages[l], (i + 1) * stages[l])
          .map((cx) => ({ key: `${l}-${x}-${cx}`, x1: x, y1: l * LEVEL, x2: cx, y2: (l + 1) * LEVEL })),
      ),
    );
  const dots = levels.flatMap((row, l) => row.map((x) => ({ key: `${l}-${x}`, x, y: l * LEVEL, r: l === levels.length - 1 ? 4 : 5 })));
  return (
    <svg className="balancer-tree" viewBox={`-8 -8 ${width} ${(levels.length - 1) * LEVEL + 16}`} role="img" aria-hidden>
      {lines.map(({ key, ...l }) => (
        <line key={key} {...l} />
      ))}
      {dots.map(({ key, x, y, r }) => (
        <circle key={key} cx={x} cy={y} r={r} />
      ))}
    </svg>
  );
}

/** A belt shared out between n machines: the splitters it takes, and how to place them. */
export function Balancer({ n }: { n: number }) {
  const { t } = useT();
  const b = balancerFor(n);
  if (b.kind === 'none') return null;
  return (
    <div className="inspector-balancer">
      <dt>{t('balancerTitle')}</dt>
      {b.kind === 'tree' ? (
        <>
          <dd>{t('balancerTree', { steps: b.stages.join(` ${t('thenWord')} `), n: b.splitters })}</dd>
          {n <= 16 && (
            <dd>
              <Tree stages={b.stages} />
            </dd>
          )}
        </>
      ) : (
        <>
          <dd>{t('balancerManifold', { n: b.splitters })}</dd>
          <dd className="hint">{t('balancerNearest', { near: b.nearest ?? 0 })}</dd>
        </>
      )}
    </div>
  );
}
