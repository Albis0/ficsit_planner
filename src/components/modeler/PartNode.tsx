import { Handle, type NodeProps, Position } from '@xyflow/react';
import { createContext, memo, useContext } from 'react';
import { data } from '../../lib/data';
import { useT } from '../../lib/i18n';
import { LOGISTICS, SINK, STORAGE, STORAGE_NAME } from '../../lib/model/catalog';
import { countOf, type NodeCalc, type NodeStatus } from '../../lib/model/calc/result';
import type { Flag, OpenEnds } from '../../lib/model/checks';
import { cardSize, type Dir, endSpot } from '../../lib/model/layout';
import { extractorById, type Port, portsOf, runnerRecipe } from '../../lib/model/ports';
import { evenSpeed, fullSpeed } from '../../lib/model/ops';
import type { MNode } from '../../lib/model/types';
import { describeUse } from '../../lib/solver';
import { minerLabel, recipeLabel } from '../../lib/text';
import { modBar, RunLine } from '../GraphView';
import { Icon } from '../Icon';
import { Slot } from '../Slot';

/** Which way the floor runs: a card's ends go on its sides or along its top and bottom. */
export const FloorDir = createContext<Dir>('LR');

/** A card's size on the floor, whole grid squares, whatever the card size and text settings say elsewhere. */
const grid = (n: MNode, dir: Dir) => {
  const { w, h } = cardSize(n, dir);
  return { width: w, height: h };
};

/** The numbers for every node, by id; one context so a card re-renders only when its own numbers change. */
export const CalcNodes = createContext<Record<string, NodeCalc> | undefined>(undefined);

/** Cards that go against the side panel, by id. */
export const CardFlags = createContext<Map<string, Flag> | undefined>(undefined);

/** What a flag says: short on a card, in full in the panel. */
export function useFlagText() {
  const { t, num, name } = useT();
  return (f: Flag, long = false): string => {
    if (f.k === 'off') return t('flagOff');
    if (f.k === 'tier') return t('needsTier', { tier: f.tier });
    if (!long) return t('flagCap');
    return t(f.world ? 'flagWorldLong' : 'flagCapLong', { item: name(data.items[f.item]), rate: num(f.rate), cap: num(f.cap) });
  };
}

/** A tag over a card that goes against the side panel. */
function FlagTag({ id }: { id: string }) {
  const flag = useContext(CardFlags)?.get(id);
  const text = useFlagText();
  if (!flag) return null;
  return (
    <span className="card-flag" title={text(flag, true)}>
      {text(flag)}
    </span>
  );
}

/** Changes a node from a button on its card. */
export const EditCard = createContext<(id: string, patch: Record<string, unknown>) => void>(() => {});

/** Takes a card off the floor, from the × on an output or input. */
export const RemoveCard = createContext<(id: string) => void>(() => {});

/**
 * The same output another way: the machines at 100% with one slower, or every machine at one clock. On a card only the
 * one that would change something shows; in the panel both always do, greyed out when there's nothing to change. A
 * machine sizing itself keeps doing so: only its clock changes, and its count follows.
 */
export function SpeedButtons({
  n,
  clock,
  auto,
  onChange,
  small,
}: {
  n: number;
  clock: number;
  auto?: boolean;
  onChange: (patch: { n?: number; clock?: number }) => void;
  small?: boolean;
}) {
  const { t } = useT();
  const fill = Math.abs(clock - 1) > 1e-9;
  const even = Math.abs(n - Math.round(n)) > 1e-6 && n > 1;
  if (small && !fill && !even) return null;
  const apply = (patch: { n?: number; clock?: number }) => onChange(auto ? { clock: patch.clock } : patch);
  return (
    <div className={`speed-buttons ${small ? 'small nodrag nopan' : ''}`}>
      {(fill || !small) && (
        <button
          type="button"
          className="floor-button"
          title={t('fullSpeedHint')}
          disabled={!fill}
          onClick={() => apply(fullSpeed(n, clock))}
        >
          {t('fullSpeed')}
        </button>
      )}
      {(even || !small) && (
        <button
          type="button"
          className="floor-button"
          title={t('evenSpeedHint')}
          disabled={!even}
          onClick={() => apply(evenSpeed(n, clock))}
        >
          {t('evenSpeed')}
        </button>
      )}
    </div>
  );
}

export interface PartData extends Record<string, unknown> {
  node: MNode;
  /** Which ends have a belt on them. */
  wired: { ins: boolean[]; outs: boolean[] };
  /** Which ends need one and have none: a splitter's spare outputs don't. */
  open?: OpenEnds;
}

/** What a status says on a card, and the tone it's shown in. */
export function useStatusText() {
  const { t, num } = useT();
  return (status: NodeStatus, u: number): { text: string; tone: 'good' | 'warn' | 'bad' } => {
    switch (status) {
      case 'full':
        return { text: t('runFull'), tone: 'good' };
      case 'partial':
        return { text: t('runPartial', { n: num(u * 100) }), tone: 'warn' };
      case 'idle':
        return { text: t('runIdle'), tone: 'warn' };
      case 'noInput':
        return { text: t('runNoInput'), tone: 'bad' };
      case 'noOutput':
        return { text: t('runNoOutput'), tone: 'bad' };
      case 'jam':
        return { text: t('runJam'), tone: 'bad' };
      case 'deadlock':
        return { text: t('runDeadlock'), tone: 'bad' };
      default:
        return { text: t('runUnknown'), tone: 'bad' };
    }
  };
}

/**
 * One end of a node: a square on its edge holding the item's icon, dashed in orange while it needs a belt. An output
 * with nothing on it says what comes out there, so a line that ends in a machine shows what it makes.
 */
function End({
  side,
  i,
  at,
  down,
  port,
  wired,
  open,
  spare,
}: {
  side: 'in' | 'out';
  i: number;
  /** Where it sits on its card, on the grid. */
  at: { x: number; y: number };
  /** On a floor running top to bottom: along the card's top or bottom. */
  down: boolean;
  port: Port;
  wired: boolean;
  open: boolean;
  spare?: number;
}) {
  const { t, name, num } = useT();
  const item = port.item ? data.items[port.item] : undefined;
  return (
    <Handle
      type={side === 'in' ? 'target' : 'source'}
      position={down ? (side === 'in' ? Position.Top : Position.Bottom) : side === 'in' ? Position.Left : Position.Right}
      id={`${side === 'in' ? 'i' : 'o'}${i}`}
      className={`port ${side} ${down ? 'down' : ''} ${wired ? 'wired' : open ? 'open' : 'free'} ${port.medium === 'pipe' ? 'pipe' : ''}`}
      // Measured from inside the card's left edge, which is thicker on some cards: taken off so every end sits on its grid line.
      style={down ? { left: `calc(${at.x}px - var(--edge-l, 1px))` } : { top: at.y }}
      title={item ? name(item) : undefined}
    >
      {item && <Icon id={item.id} size={18} />}
      {spare !== undefined && spare > 1e-9 && (
        <span className="port-spare">
          {num(spare)}
          <small>{t('perMin')}</small>
        </span>
      )}
    </Handle>
  );
}

function Ends({ node, wired, open }: PartData) {
  const ports = portsOf(node);
  const dir = useContext(FloorDir);
  const down = dir === 'TB';
  const spare = useContext(CalcNodes)?.[node.id]?.spare;
  return (
    <>
      {ports.ins.map((p, i) => (
        <End
          // biome-ignore lint/suspicious/noArrayIndexKey: ends are fixed by the node's recipe or kind, never reordered here.
          key={`i${i}`}
          side="in"
          i={i}
          at={endSpot(node, 'in', i, dir)}
          down={down}
          port={p}
          wired={wired.ins[i]}
          open={!!open?.ins[i]}
        />
      ))}
      {ports.outs.map((p, i) => (
        <End
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          key={`o${i}`}
          side="out"
          i={i}
          at={endSpot(node, 'out', i, dir)}
          down={down}
          port={p}
          wired={wired.outs[i]}
          open={!!open?.outs[i]}
          spare={wired.outs[i] ? undefined : spare?.[i]}
        />
      ))}
    </>
  );
}

function Status({ calc }: { calc?: NodeCalc }) {
  const text = useStatusText();
  if (!calc) return null;
  const s = text(calc.status, calc.u);
  return <span className={`run-state ${s.tone}`}>{s.text}</span>;
}

function Machine({ data: d, selected }: { data: PartData; selected: boolean }) {
  const dir = useContext(FloorDir);
  const { t, name, num } = useT();
  const n = d.node;
  const calc = useContext(CalcNodes)?.[n.id];
  const edit = useContext(EditCard);
  if (n.k !== 'machine' && n.k !== 'gen') return null;
  const recipe = runnerRecipe(n);
  if (!recipe) return null;
  const auto = n.k === 'machine' && !!n.auto;
  const count = countOf(n, calc);
  const use = describeUse(recipe, { clock: n.clock ?? 1, sloops: n.k === 'machine' ? (n.sloops ?? 0) : 0 }, count || 1, true);
  const bar = modBar(use.shards, use.sloops);
  return (
    <div
      className={`machine-node manual ${recipe.kind} ${selected ? 'selected' : ''} ${n.done ? 'done' : ''}`}
      style={{ ...grid(n, dir), ...(bar ? { ['--mod-bar' as string]: bar } : {}) }}
    >
      <FlagTag id={n.id} />
      <Ends {...d} />
      <div className="machine-strip">
        <Icon id={recipe.outputs[0]?.item ?? recipe.machine} size={30} className="strip-icon" />
        <span className="machine-product" title={recipeLabel(name(recipe), recipe.kind)}>
          {n.label ?? recipeLabel(name(recipe), recipe.kind)}
        </span>
        {selected && count > 0 && <SpeedButtons n={count} clock={n.clock ?? 1} auto={auto} onChange={(patch) => edit(n.id, patch)} small />}
      </div>
      <div className="machine-body">
        <Icon id={recipe.machine} size={60} className="machine-icon" />
        <span className="machine-info">
          <span className="machine-type">{name(data.machines[recipe.machine] ?? { name: recipe.machine })}</span>
          {auto && count <= 1e-9 ? (
            <span className="machine-run">
              <span className="auto-tag">{t('autoCount')}</span>
            </span>
          ) : (
            <span className="run-with-auto">
              <RunLine clocks={use.clocks} />
              {auto && (
                <span className="auto-tag" title={t('autoCountHint')}>
                  {t('autoCount')}
                </span>
              )}
            </span>
          )}
          <span className="machine-mods">
            {recipe.kind !== 'power' && calc && (
              <span className="machine-draw">
                {num(use.power * (calc?.u ?? 0))}
                <small>MW</small>
              </span>
            )}
            {use.shards > 0 && <span className="mod-badge shard">{use.shards} ◆</span>}
            {use.sloops > 0 && <span className="mod-badge sloop">{use.sloops} ●</span>}
            <Status calc={calc} />
          </span>
        </span>
      </div>
    </div>
  );
}

/** Sources and ends of the line, in the Auto floor's endpoint look: miners and pumps, inputs from outside, outputs. */
function Endpoint({ data: d, selected }: { data: PartData; selected: boolean }) {
  const dir = useContext(FloorDir);
  const remove = useContext(RemoveCard);
  const { t, name, num } = useT();
  const n = d.node;
  const calc = useContext(CalcNodes)?.[n.id];
  let kind: string;
  let label: string;
  let item: string | undefined;
  let rate: number;
  let note = '';
  if (n.k === 'extract') {
    const e = extractorById.get(n.extractor);
    item = n.item;
    kind = 'raw';
    label = e ? minerLabel(name(e)) : '';
    if (e?.purity) label += ` · ${t(n.purity ?? 'normal')}`;
    // On a belt, or left over where the miner has none.
    rate = (calc?.outs[0] ?? 0) + (calc?.spare?.[0] ?? 0);
    const built = Math.max(1, Math.ceil((n.n ?? 1) - 1e-6));
    // Held back by what takes its ore, a miner is as good as one clocked down to that: say the clock, as in the game.
    const held = calc?.status === 'partial' ? calc.u : 1;
    note = `${built}× ${num((((n.clock ?? 1) * (n.n ?? 1) * held) / built) * 100)}%`;
  } else if (n.k === 'in') {
    item = n.item;
    kind = n.tag === 'bring' ? 'missing' : 'supply';
    label = n.tag === 'bring' ? t('bringIn') : t('comesIn');
    rate = calc?.outs[0] ?? 0;
    if (n.lim !== undefined) note = t('upTo', { n: num(n.lim) });
  } else if (n.k === 'out') {
    item = n.item;
    kind = n.tag === 'spare' ? 'surplus' : 'target';
    label = n.tag === 'spare' ? t('surplus') : t('output');
    rate = calc?.ins[0] ?? 0;
    if (n.lim !== undefined) note = t('upTo', { n: num(n.lim) });
  } else return null;
  const it = item ? data.items[item] : undefined;
  return (
    <div
      className={`endpoint-node manual ${kind} ${selected ? 'selected' : ''} ${n.done ? 'done' : ''}`}
      style={{ ...grid(n, dir), ...(it && it.form !== 'solid' ? { ['--fluid-color' as string]: it.color ?? 'var(--fluid)' } : {}) }}
    >
      <FlagTag id={n.id} />
      <Ends {...d} />
      {(n.k === 'in' || n.k === 'out') && (
        <button
          type="button"
          className="card-x nodrag nopan"
          aria-label={`${t('remove')} ${it ? name(it) : t('anything')}`}
          onClick={() => remove(n.id)}
        >
          ×
        </button>
      )}
      {it ? <Slot id={it.id} size={60} tone={kind === 'target' ? 'target' : 'default'} /> : <span className="slot-empty" />}
      <span className="endpoint-text">
        <span className="endpoint-kind">{n.label ?? label}</span>
        <span className="endpoint-name" title={it ? name(it) : undefined}>
          {it ? name(it) : t('anything')}
        </span>
        <span className="endpoint-line">
          {calc && (
            <span className="endpoint-rate">
              {num(rate)}
              <small>{t('perMin')}</small>
            </span>
          )}
          {note && <span className="endpoint-extract">{note}</span>}
          {n.k === 'extract' && calc?.status !== 'partial' && <Status calc={calc} />}
        </span>
      </span>
    </div>
  );
}

/** Splitters, mergers, sinks and containers: a small square with the building's icon. */
function Fitting({ data: d, selected }: { data: PartData; selected: boolean }) {
  const dir = useContext(FloorDir);
  const n = d.node;
  const calc = useContext(CalcNodes)?.[n.id];
  const { num, t } = useT();
  let icon: string;
  let title: string;
  if (n.k === 'logistic') ({ icon, name: title } = LOGISTICS[n.kind]);
  else if (n.k === 'sink') ({ icon, name: title } = SINK);
  else if (n.k === 'storage') {
    icon = STORAGE[n.mode].icon;
    title = STORAGE_NAME;
  } else {
    icon = '';
    title = n.k === 'unknown' ? n.was : '';
  }
  const through = calc
    ? Math.max(
        calc.ins.reduce((a, b) => a + b, 0),
        calc.outs.reduce((a, b) => a + b, 0),
      )
    : 0;
  return (
    <div
      className={`fitting-node ${n.k} ${selected ? 'selected' : ''} ${n.done ? 'done' : ''}`}
      style={grid(n, dir)}
      title={n.label ?? title}
    >
      <Ends {...d} />
      {icon ? <Icon id={icon} size={44} /> : <span className="fitting-unknown">?</span>}
      {calc && (
        <span className="fitting-rate">
          {num(through)}
          <small>{t('perMin')}</small>
        </span>
      )}
    </div>
  );
}

export const PartNode = memo(function PartNode({ data: d, selected }: NodeProps) {
  const part = d as PartData;
  switch (part.node.k) {
    case 'machine':
    case 'gen':
      return <Machine data={part} selected={!!selected} />;
    case 'extract':
    case 'in':
    case 'out':
      return <Endpoint data={part} selected={!!selected} />;
    default:
      return <Fitting data={part} selected={!!selected} />;
  }
});
