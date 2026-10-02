import { Handle, type NodeProps, Position } from '@xyflow/react';
import { createContext, memo, useContext } from 'react';
import { data } from '../../lib/data';
import { useT } from '../../lib/i18n';
import { LOGISTICS, SINK, STORAGE, STORAGE_NAME } from '../../lib/model/catalog';
import type { NodeCalc, NodeStatus } from '../../lib/model/calc/result';
import type { OpenEnds } from '../../lib/model/checks';
import { extractorById, type Port, portsOf, runnerRecipe } from '../../lib/model/ports';
import { evenSpeed, fullSpeed } from '../../lib/model/ops';
import type { MNode } from '../../lib/model/types';
import { describeUse } from '../../lib/solver';
import { minerLabel, recipeLabel } from '../../lib/text';
import { modBar, RunLine } from '../GraphView';
import { Icon } from '../Icon';
import { Slot } from '../Slot';

/** The numbers for every node, by id; one context so a card re-renders only when its own numbers change. */
export const CalcNodes = createContext<Record<string, NodeCalc> | undefined>(undefined);

/** Changes a node from a button on its card. */
export const EditCard = createContext<(id: string, patch: Record<string, unknown>) => void>(() => {});

/** The same output another way: the machines at 100% with one slower, or every machine at one clock. */
export function SpeedButtons({
  n,
  clock,
  onChange,
  small,
}: {
  n: number;
  clock: number;
  onChange: (patch: { n?: number; clock?: number }) => void;
  small?: boolean;
}) {
  const { t } = useT();
  const fill = Math.abs(clock - 1) > 1e-9;
  const even = Math.abs(n - Math.round(n)) > 1e-6 && n > 1;
  if (!fill && !even) return null;
  return (
    <div className={`speed-buttons ${small ? 'small nodrag nopan' : ''}`}>
      {fill && (
        <button type="button" className="floor-button" title={t('fullSpeedHint')} onClick={() => onChange(fullSpeed(n, clock))}>
          {t('fullSpeed')}
        </button>
      )}
      {even && (
        <button type="button" className="floor-button" title={t('evenSpeedHint')} onClick={() => onChange(evenSpeed(n, clock))}>
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

/** One end of a node: a square on its edge holding the item's icon, dashed in orange while it needs a belt. */
function End({ side, i, of, port, wired, open }: { side: 'in' | 'out'; i: number; of: number; port: Port; wired: boolean; open: boolean }) {
  const { name } = useT();
  const item = port.item ? data.items[port.item] : undefined;
  return (
    <Handle
      type={side === 'in' ? 'target' : 'source'}
      position={side === 'in' ? Position.Left : Position.Right}
      id={`${side === 'in' ? 'i' : 'o'}${i}`}
      className={`port ${side} ${wired ? 'wired' : open ? 'open' : 'free'} ${port.medium === 'pipe' ? 'pipe' : ''}`}
      style={{ top: `${((i + 1) / (of + 1)) * 100}%` }}
      title={item ? name(item) : undefined}
    >
      {item && <Icon id={item.id} size={18} />}
    </Handle>
  );
}

function Ends({ node, wired, open }: PartData) {
  const ports = portsOf(node);
  return (
    <>
      {ports.ins.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: ends are fixed by the node's recipe or kind, never reordered here.
        <End key={`i${i}`} side="in" i={i} of={ports.ins.length} port={p} wired={wired.ins[i]} open={!!open?.ins[i]} />
      ))}
      {ports.outs.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: as above.
        <End key={`o${i}`} side="out" i={i} of={ports.outs.length} port={p} wired={wired.outs[i]} open={!!open?.outs[i]} />
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
  const { name, num } = useT();
  const n = d.node;
  const calc = useContext(CalcNodes)?.[n.id];
  const edit = useContext(EditCard);
  if (n.k !== 'machine' && n.k !== 'gen') return null;
  const recipe = runnerRecipe(n);
  if (!recipe) return null;
  const use = describeUse(recipe, { clock: n.clock ?? 1, sloops: n.k === 'machine' ? (n.sloops ?? 0) : 0 }, n.n ?? 1, true);
  const bar = modBar(use.shards, use.sloops);
  const ends = Math.max(recipe.inputs.length, recipe.outputs.length);
  return (
    <div
      className={`machine-node manual ${recipe.kind} ${selected ? 'selected' : ''} ${n.done ? 'done' : ''}`}
      style={{
        ['--run-extra' as string]: Math.max(0, ends - 3) * 0.6 + Math.max(0, new Set(use.clocks).size - 1),
        ...(bar ? { ['--mod-bar' as string]: bar } : {}),
      }}
    >
      <Ends {...d} />
      <div className="machine-strip">
        <Icon id={recipe.outputs[0]?.item ?? recipe.machine} size={30} className="strip-icon" />
        <span className="machine-product" title={recipeLabel(name(recipe), recipe.kind)}>
          {n.label ?? recipeLabel(name(recipe), recipe.kind)}
        </span>
        {selected && <SpeedButtons n={n.n ?? 1} clock={n.clock ?? 1} onChange={(patch) => edit(n.id, patch)} small />}
      </div>
      <div className="machine-body">
        <Icon id={recipe.machine} size={60} className="machine-icon" />
        <span className="machine-info">
          <span className="machine-type">{name(data.machines[recipe.machine] ?? { name: recipe.machine })}</span>
          <RunLine clocks={use.clocks} />
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
    rate = calc?.outs[0] ?? 0;
    const built = Math.max(1, Math.ceil((n.n ?? 1) - 1e-6));
    note = `${built}× ${num((((n.clock ?? 1) * (n.n ?? 1)) / built) * 100)}%`;
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
      style={it && it.form !== 'solid' ? { ['--fluid-color' as string]: it.color ?? 'var(--fluid)' } : undefined}
    >
      <Ends {...d} />
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
          {n.k === 'extract' && <Status calc={calc} />}
        </span>
      </span>
    </div>
  );
}

/** Splitters, mergers, sinks and containers: a small square with the building's icon. */
function Fitting({ data: d, selected }: { data: PartData; selected: boolean }) {
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
    <div className={`fitting-node ${n.k} ${selected ? 'selected' : ''} ${n.done ? 'done' : ''}`} title={n.label ?? title}>
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
