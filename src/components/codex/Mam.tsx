import { useMemo, useState } from 'react';
import { type CodexIndex, type Schematic, schematicIcon } from '../../lib/codex';
import { useT } from '../../lib/i18n';
import { Icon } from '../Icon';
import { Tile } from './browse';
import { Amount, Amounts, Section } from './parts';
import { AdaButton } from './Ada';
import { CodexLink } from './route';

// One grid cell, and the side of the square a research sits in.
const CELL = 104;
const BOX = 68;
// The order of the game's own menu.
const ORDER = ['Alien Organisms', 'Alien Tech', 'Caterium', 'Nutrients', 'Power Slugs', 'Quartz', 'Sulfur', 'Mycelia'];

/** The MAM the way the game shows it: its trees in a menu, the researches on the game's own grid joined by its own lines. */
export function MamScreen({ index }: { index: CodexIndex }) {
  const { t, num } = useT();
  const trees = Object.keys(index.data.mam).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const [tree, setTree] = useState(trees[0]);
  // A tree is pictured by its first research, the one nothing comes before.
  const treeIcon = (name: string) => {
    const nodes = index.data.mam[name].nodes;
    const root = nodes.find((n) => !n.parents.length) ?? nodes[0];
    return schematicIcon(index.schematic.get(root.id)!, index.data) ?? '';
  };
  const [picked, setPicked] = useState<string>();
  const { cols, rows, nodes } = index.data.mam[tree];
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const centre = (x: number, y: number) => `${x * CELL + CELL / 2},${y * CELL + CELL / 2}`;
  const sel = picked ? byId.get(picked) : undefined;
  const s = sel && index.schematic.get(sel.id);
  // A line is lit when it leads into, or out of, the research that is open.
  const lines = nodes.flatMap((n) =>
    n.roads.flatMap((r) => {
      const to = byId.get(r.to);
      if (!to) return [];
      const pts = [centre(n.x, n.y), ...r.points.map(([x, y]) => centre(x, y))];
      const end = centre(to.x, to.y);
      if (pts[pts.length - 1] !== end) pts.push(end);
      return [{ key: `${n.id}>${r.to}`, d: pts.join(' '), lit: r.to === picked || n.id === picked }];
    }),
  );
  // Researches the game keeps off every tree, minus the retired ones.
  const onTree = useMemo(() => new Set(Object.values(index.data.mam).flatMap((m) => m.nodes.map((n) => n.id))), [index]);
  const loose = index.data.schematics.filter((x) => x.type === 'mam' && !onTree.has(x.id) && !/^Discontinued/i.test(x.name));
  const time = ({ time: sec = 0 }: Schematic) => (sec >= 60 ? t('minutesShort', { n: num(sec / 60) }) : t('secondsN', { n: num(sec) }));
  const hiddenBy = sel?.hiddenBy.map((h) => index.schematic.get(h)?.name).find(Boolean);

  return (
    <>
      <div className={`mam${s ? ' open' : ''}`}>
        <div className="mam-menu" role="tablist" aria-label={t('mamTrees')}>
          {trees.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={name === tree}
              className={`mam-tab${name === tree ? ' current' : ''}`}
              onClick={() => {
                setTree(name);
                setPicked(undefined);
              }}
            >
              <Icon id={treeIcon(name)} size={32} />
              <span className="mam-tab-name">{name}</span>
              <span className="mam-tab-count">{index.data.mam[name].nodes.length}</span>
            </button>
          ))}
        </div>
        <div className="mam-board">
          <div className="mam-grid" style={{ width: cols * CELL, height: rows * CELL, backgroundSize: `${CELL}px ${CELL}px` }}>
            <svg className="mam-lines" width={cols * CELL} height={rows * CELL} aria-hidden>
              {lines.map((l) => (
                <polyline key={l.key} points={l.d} className={l.lit ? 'lit' : undefined} />
              ))}
            </svg>
            {nodes.map((n) => {
              const x = index.schematic.get(n.id);
              if (!x) return null;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`mam-node${n.id === picked ? ' current' : ''}`}
                  style={{ left: n.x * CELL + (CELL - BOX) / 2, top: n.y * CELL + (CELL - BOX) / 2, width: BOX, height: BOX }}
                  aria-pressed={n.id === picked}
                  aria-label={x.name}
                  title={x.name}
                  onClick={() => setPicked(n.id === picked ? undefined : n.id)}
                >
                  <Icon id={schematicIcon(x, index.data) ?? ''} size={52} />
                </button>
              );
            })}
          </div>
        </div>
        {s && (
          <aside className="mam-detail">
            <button type="button" className="mam-close" aria-label={t('close')} onClick={() => setPicked(undefined)}>
              ×
            </button>
            <div className="ada-title">
              <h3 className="mam-detail-name">{s.name}</h3>
              <AdaButton id={s.id} />
            </div>
            <p className="mam-detail-sub">
              {time(s)}
              {hiddenBy ? ` · ${t('mamAppearsAfter', { name: hiddenBy })}` : ''}
            </p>
            {s.unlocks.length > 0 && (
              <>
                <h4 className="mam-detail-h">{t('unlocksTitle')}</h4>
                <div className="mam-rewards">
                  {s.unlocks.map((u) => (
                    <Amount key={u} item={u} index={index} />
                  ))}
                </div>
              </>
            )}
            {s.cost.length > 0 && (
              <>
                <h4 className="mam-detail-h">{t('researchCost')}</h4>
                <Amounts list={s.cost} index={index} />
              </>
            )}
            <CodexLink page={{ kind: 'schematic', id: s.id }} className="mam-open">
              {t('mamOpenPage')}
            </CodexLink>
          </aside>
        )}
      </div>
      {loose.length > 0 && (
        <Section title={t('mamOutside')} count={loose.length}>
          <div className="codex-tiles">
            {loose.map((x) => (
              <Tile
                key={x.id}
                entry={{ page: { kind: 'schematic', id: x.id }, name: x.name, icon: schematicIcon(x, index.data), note: x.group }}
              />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
